from __future__ import annotations

from http.cookies import SimpleCookie
from typing import Any
from unittest import mock

import pytest
from django.conf import settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from apps.accounts.models import Role, User
from apps.accounts.throttles import AuthRateThrottle
from apps.audit.models import AuditLog
from tests.conftest import PASSWORD, bearer

COOKIE = settings.REFRESH_COOKIE["NAME"]
CSRF: dict[str, Any] = {"HTTP_X_CSRF_PROTECTION": "1"}

pytestmark = pytest.mark.django_db


def login(client: APIClient, email: str, password: str = PASSWORD):
    return client.post("/api/auth/login/", {"email": email, "password": password})


def refresh(client: APIClient, **headers):
    return client.post("/api/auth/refresh/", **{**CSRF, **headers})


class TestRegister:
    def test_creates_customer_and_starts_session(self, api: APIClient) -> None:
        response = api.post(
            "/api/auth/register/",
            {"email": "New@Example.com", "full_name": "New Person", "password": PASSWORD},
        )
        assert response.status_code == 201
        assert response.data["user"]["email"] == "new@example.com"
        assert response.data["user"]["role"] == "customer"
        assert response.data["access"]
        assert COOKIE in response.cookies

    def test_client_cannot_self_assign_admin_role(self, api: APIClient) -> None:
        response = api.post(
            "/api/auth/register/",
            {
                "email": "sneaky@example.com",
                "full_name": "Sneaky",
                "password": PASSWORD,
                "role": "admin",
            },
        )
        assert response.status_code == 201
        assert User.objects.get(email="sneaky@example.com").role == Role.CUSTOMER

    def test_duplicate_email_is_case_insensitive(self, api: APIClient, customer: User) -> None:
        response = api.post(
            "/api/auth/register/",
            {"email": "CUSTOMER@example.com", "full_name": "Dup", "password": PASSWORD},
        )
        assert response.status_code == 400
        assert "email" in response.data["error"]["fields"]

    @pytest.mark.parametrize("password", ["short1!", "password123", "1234567890123"])
    def test_weak_passwords_are_rejected(self, api: APIClient, password: str) -> None:
        response = api.post(
            "/api/auth/register/",
            {"email": "weak@example.com", "full_name": "Weak", "password": password},
        )
        assert response.status_code == 400
        assert not User.objects.filter(email="weak@example.com").exists()

    def test_passwords_are_hashed_never_stored_in_plain_text(self, customer: User) -> None:
        assert PASSWORD not in customer.password
        assert customer.check_password(PASSWORD)


class TestLogin:
    def test_success_returns_access_token_and_secure_refresh_cookie(
        self, api: APIClient, customer: User
    ) -> None:
        response = login(api, "customer@example.com")
        assert response.status_code == 200
        assert response.data["user"]["id"] == customer.id
        assert "refresh" not in response.data  # never exposed to JavaScript

        cookie = response.cookies[COOKIE]
        assert cookie["httponly"]
        assert cookie["secure"]
        assert cookie["samesite"] == "Strict"
        assert cookie["path"] == "/api/auth/"

    def test_email_is_case_insensitive(self, api: APIClient, customer: User) -> None:
        assert login(api, "Customer@Example.COM").status_code == 200

    @pytest.mark.parametrize(
        ("email", "password"),
        [("customer@example.com", "wrong-password"), ("nobody@example.com", PASSWORD)],
    )
    def test_failure_uses_generic_message_and_is_audited(
        self, api: APIClient, customer: User, email: str, password: str
    ) -> None:
        response = login(api, email, password)
        assert response.status_code == 401
        assert response.data["error"]["message"] == "Invalid email or password."
        assert AuditLog.objects.filter(action="auth.login_failed", changes__email=email).exists()

    def test_inactive_user_cannot_log_in(self, api: APIClient, customer: User) -> None:
        customer.is_active = False
        customer.save()
        assert login(api, "customer@example.com").status_code == 401

    def test_login_is_rate_limited(self, api: APIClient, customer: User) -> None:
        with (
            mock.patch.object(AuthRateThrottle, "rate", "3/min", create=True),
            mock.patch.object(AuthRateThrottle, "get_rate", return_value="3/min"),
        ):
            statuses = [login(api, "customer@example.com", "bad").status_code for _ in range(4)]
        assert statuses == [401, 401, 401, 429]


class TestRefreshRotation:
    def test_requires_csrf_header(self, api: APIClient, customer: User) -> None:
        login(api, "customer@example.com")
        response = api.post("/api/auth/refresh/")
        assert response.status_code == 403

    def test_without_cookie_is_unauthorized(self, api: APIClient) -> None:
        assert refresh(api).status_code == 401

    def test_rotates_and_blacklists_previous_token(self, api: APIClient, customer: User) -> None:
        first = login(api, "customer@example.com").cookies[COOKIE].value
        response = refresh(api)
        assert response.status_code == 200
        second = response.cookies[COOKIE].value
        assert second != first
        assert response.data["access"]

        # Presenting the old token again fails...
        replay = APIClient()
        replay.cookies = SimpleCookie({COOKIE: first})
        assert refresh(replay).status_code == 401

    def test_reuse_of_rotated_token_revokes_whole_session_family(
        self, api: APIClient, customer: User
    ) -> None:
        stolen = login(api, "customer@example.com").cookies[COOKIE].value
        assert refresh(api).status_code == 200  # legitimate client rotates

        attacker = APIClient()
        attacker.cookies = SimpleCookie({COOKIE: stolen})
        assert refresh(attacker).status_code == 401
        # ...and the legitimate client's *new* token is now revoked too.
        assert refresh(api).status_code == 401
        assert AuditLog.objects.filter(action="auth.refresh_reuse_detected").exists()
        outstanding = OutstandingToken.objects.filter(user=customer).count()
        assert BlacklistedToken.objects.filter(token__user=customer).count() == outstanding

    def test_forged_token_is_rejected(self, api: APIClient) -> None:
        api.cookies = SimpleCookie({COOKIE: "eyJhbGciOiJIUzI1NiJ9.e30.forged"})
        response = refresh(api)
        assert response.status_code == 401
        assert response.cookies[COOKIE].value == ""  # cookie cleared

    def test_deactivated_user_cannot_refresh(self, api: APIClient, customer: User) -> None:
        login(api, "customer@example.com")
        User.objects.filter(pk=customer.pk).update(is_active=False)
        assert refresh(api).status_code == 401


class TestLogoutAndSessions:
    def test_logout_revokes_refresh_token(self, api: APIClient, customer: User) -> None:
        token = login(api, "customer@example.com").cookies[COOKIE].value
        response = api.post("/api/auth/logout/", **CSRF)
        assert response.status_code == 204
        assert response.cookies[COOKIE].value == ""

        replay = APIClient()
        replay.cookies = SimpleCookie({COOKIE: token})
        assert refresh(replay).status_code == 401

    def test_logout_requires_csrf_header(self, api: APIClient) -> None:
        assert api.post("/api/auth/logout/").status_code == 403

    def test_me_requires_authentication(self, api: APIClient) -> None:
        assert api.get("/api/auth/me/").status_code == 401

    def test_me_returns_profile_and_role_is_read_only(self, customer_api: APIClient) -> None:
        response = customer_api.patch("/api/auth/me/", {"full_name": "Renamed", "role": "admin"})
        assert response.status_code == 200
        assert response.data["full_name"] == "Renamed"
        assert response.data["role"] == "customer"

    def test_invalid_bearer_token_is_rejected(self, api: APIClient) -> None:
        api.credentials(HTTP_AUTHORIZATION="Bearer not-a-jwt")
        assert api.get("/api/auth/me/").status_code == 401

    def test_access_token_of_deactivated_user_stops_working(
        self, customer_api: APIClient, customer: User
    ) -> None:
        assert customer_api.get("/api/auth/me/").status_code == 200
        User.objects.filter(pk=customer.pk).update(is_active=False)
        assert customer_api.get("/api/auth/me/").status_code == 401

    def test_change_password_revokes_existing_sessions(
        self, api: APIClient, customer: User
    ) -> None:
        old_refresh = login(api, "customer@example.com").cookies[COOKIE].value
        bearer(api, customer)
        response = api.post(
            "/api/auth/password/",
            {"current_password": PASSWORD, "new_password": "An0ther-Strong-Pass"},
        )
        assert response.status_code == 200
        replay = APIClient()
        replay.cookies = SimpleCookie({COOKIE: old_refresh})
        assert refresh(replay).status_code == 401
        assert login(APIClient(), "customer@example.com", "An0ther-Strong-Pass").status_code == 200

    def test_change_password_checks_current_password(self, customer_api: APIClient) -> None:
        response = customer_api.post(
            "/api/auth/password/",
            {"current_password": "nope", "new_password": "An0ther-Strong-Pass"},
        )
        assert response.status_code == 400
        assert "current_password" in response.data["error"]["fields"]
