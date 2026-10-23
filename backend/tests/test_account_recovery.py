"""Email verification and password reset: tokens, enumeration resistance, revocation, abuse."""

from __future__ import annotations

import hashlib
import importlib
import re
import statistics
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import timedelta
from smtplib import SMTPServerDisconnected
from typing import Any
from unittest import mock

import pytest
from django.conf import settings
from django.core import mail
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

import config.settings as settings_module
from apps.accounts import emails, onetime, tokens
from apps.accounts.models import OneTimeToken, TokenPurpose, User
from apps.accounts.throttles import AccountEmailRateThrottle, RecipientBudget
from apps.audit.models import AuditLog
from tests.conftest import PASSWORD, add_to_cart, bearer, checkout

pytestmark = pytest.mark.django_db

NEW_PASSWORD = "Brand-New-Secret-77!"
COOKIE = settings.REFRESH_COOKIE["NAME"]
CSRF: dict[str, Any] = {"HTTP_X_CSRF_PROTECTION": "1"}
TOKEN_IN_LINK = re.compile(r"#token=([A-Za-z0-9_\-]+)")


@pytest.fixture
def send_now(django_capture_on_commit_callbacks: Any) -> Callable[[], Any]:
    """Run on_commit callbacks (where email is sent) inside the test transaction."""

    def _ctx() -> Any:
        return django_capture_on_commit_callbacks(execute=True)

    return _ctx


def secret_from(message: Any) -> str:
    match = TOKEN_IN_LINK.search(message.body)
    assert match, message.body
    return match.group(1)


def forgot(client: APIClient, email: str) -> Any:
    return client.post("/api/auth/password/forgot/", {"email": email})


def reset(client: APIClient, token: str, password: str = NEW_PASSWORD) -> Any:
    return client.post("/api/auth/password/reset/", {"token": token, "new_password": password})


def verify(client: APIClient, token: str) -> Any:
    return client.post("/api/auth/email/verify/", {"token": token})


@pytest.fixture
def unverified(make_user: Callable[..., User]) -> User:
    return make_user("new@example.com", email_verified_at=None, full_name="New Shopper")


class TestTokenStorage:
    def test_only_the_hash_is_stored(self, unverified: User) -> None:
        raw = onetime.issue(unverified, TokenPurpose.VERIFY_EMAIL)
        row = OneTimeToken.objects.get(user=unverified)
        assert row.token_hash == hashlib.sha256(raw.encode()).hexdigest()
        assert raw not in str(OneTimeToken.objects.values().get(pk=row.pk))
        assert len(raw) >= 43  # 32 random bytes, URL-safe base64

    def test_secrets_are_unique(self, unverified: User) -> None:
        secrets = {onetime.issue(unverified, TokenPurpose.VERIFY_EMAIL) for _ in range(20)}
        assert len(secrets) == 20

    def test_new_token_supersedes_the_previous_one(self, unverified: User, api: APIClient) -> None:
        first = onetime.issue(unverified, TokenPurpose.VERIFY_EMAIL)
        second = onetime.issue(unverified, TokenPurpose.VERIFY_EMAIL)
        assert verify(api, first).status_code == 400
        assert verify(api, second).status_code == 200

    def test_purposes_are_not_interchangeable(self, customer: User, api: APIClient) -> None:
        reset_secret = onetime.issue(customer, TokenPurpose.RESET_PASSWORD)
        assert verify(api, reset_secret).status_code == 400
        verify_secret = onetime.issue(customer, TokenPurpose.VERIFY_EMAIL)
        assert reset(api, verify_secret).status_code == 400
        customer.refresh_from_db()
        assert customer.check_password(PASSWORD)


class TestEmailVerification:
    def test_registration_sends_a_link_with_the_secret_in_the_fragment(
        self, api: APIClient, send_now: Callable[[], Any]
    ) -> None:
        with send_now():
            response = api.post(
                "/api/auth/register/",
                {"email": "fresh@example.com", "full_name": "Fresh Face", "password": PASSWORD},
            )
        assert response.status_code == 201
        assert response.data["user"]["email_verified"] is False
        assert len(mail.outbox) == 1
        message = mail.outbox[0]
        assert message.to == ["fresh@example.com"]
        assert f"{settings.APP_BASE_URL}/verify-email#token=" in message.body
        # Fragment, not query string: the secret never reaches a server log or Referer.
        assert "?token=" not in message.body
        html = message.alternatives[0][0]  # type: ignore[attr-defined]
        assert "#token=" in html

    def test_link_confirms_the_address_once(
        self, unverified: User, api: APIClient, send_now: Callable[[], Any]
    ) -> None:
        raw = onetime.issue(unverified, TokenPurpose.VERIFY_EMAIL)
        assert verify(api, raw).status_code == 200
        unverified.refresh_from_db()
        assert unverified.email_verified
        assert AuditLog.objects.filter(action="auth.email_verified", actor=unverified).exists()
        replay = verify(api, raw)
        assert replay.status_code == 400
        assert replay.data["error"]["fields"]["token"] == [
            "This link is invalid or has expired. Ask for a new one."
        ]

    def test_expired_link_is_rejected(self, unverified: User, api: APIClient) -> None:
        raw = onetime.issue(unverified, TokenPurpose.VERIFY_EMAIL)
        OneTimeToken.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        assert verify(api, raw).status_code == 400
        unverified.refresh_from_db()
        assert not unverified.email_verified

    def test_lifetime_follows_settings(self, unverified: User) -> None:
        onetime.issue(unverified, TokenPurpose.VERIFY_EMAIL)
        row = OneTimeToken.objects.get()
        assert row.expires_at - row.created_at == pytest.approx(
            timedelta(hours=settings.EMAIL_VERIFICATION_TTL_HOURS), abs=timedelta(seconds=5)
        )

    def test_link_dies_if_the_address_changed(self, unverified: User, api: APIClient) -> None:
        raw = onetime.issue(unverified, TokenPurpose.VERIFY_EMAIL)
        User.objects.filter(pk=unverified.pk).update(email="changed@example.com")
        assert verify(api, raw).status_code == 400

    def test_link_dies_with_a_suspended_account(self, unverified: User, api: APIClient) -> None:
        raw = onetime.issue(unverified, TokenPurpose.VERIFY_EMAIL)
        User.objects.filter(pk=unverified.pk).update(is_active=False)
        assert verify(api, raw).status_code == 400

    @pytest.mark.parametrize("token", ["", "x", "A" * 129, "' OR 1=1 --", "../../etc/passwd"])
    def test_garbage_tokens_are_rejected(self, api: APIClient, token: str) -> None:
        assert verify(api, token).status_code == 400

    def test_checkout_requires_a_confirmed_address(
        self, unverified: User, product: Any, api: APIClient
    ) -> None:
        client = bearer(APIClient(), unverified)
        add_to_cart(unverified, product)
        blocked = checkout(client)
        assert blocked.status_code == 403
        assert blocked.data["error"]["code"] == "email_unverified"
        product.refresh_from_db()
        assert product.stock == 10  # nothing was reserved
        verify(api, onetime.issue(unverified, TokenPurpose.VERIFY_EMAIL))
        assert checkout(client).status_code == 201

    @override_settings(REQUIRE_VERIFIED_EMAIL=False)
    def test_requirement_can_be_switched_off(self, unverified: User, product: Any) -> None:
        add_to_cart(unverified, product)
        assert checkout(bearer(APIClient(), unverified)).status_code == 201

    def test_profile_reports_verification(self, unverified: User) -> None:
        response = bearer(APIClient(), unverified).get("/api/auth/me/")
        assert response.data["email_verified"] is False


class TestResendVerification:
    def test_sends_a_fresh_link(self, unverified: User, send_now: Callable[[], Any]) -> None:
        with send_now():
            response = bearer(APIClient(), unverified).post("/api/auth/email/resend/")
        assert response.status_code == 202
        assert len(mail.outbox) == 1
        assert mail.outbox[0].to == [unverified.email]

    def test_confirmed_users_get_nothing(
        self, customer_api: APIClient, send_now: Callable[[], Any]
    ) -> None:
        with send_now():
            response = customer_api.post("/api/auth/email/resend/")
        assert response.status_code == 200
        assert mail.outbox == []

    def test_requires_a_session(self, api: APIClient) -> None:
        assert api.post("/api/auth/email/resend/").status_code == 401

    def test_inbox_budget_caps_mail_silently(
        self, unverified: User, send_now: Callable[[], Any]
    ) -> None:
        client = bearer(APIClient(), unverified)
        with send_now(), mock.patch.object(RecipientBudget, "get_rate", return_value="2/hour"):
            statuses = [client.post("/api/auth/email/resend/").status_code for _ in range(4)]
        assert statuses == [202, 202, 202, 202]
        assert len(mail.outbox) == 2


class TestForgotPassword:
    def test_known_address_gets_a_reset_link(
        self, customer: User, api: APIClient, send_now: Callable[[], Any]
    ) -> None:
        with send_now():
            response = forgot(api, "Customer@Example.com")
        assert response.status_code == 202
        assert len(mail.outbox) == 1
        assert "/reset-password#token=" in mail.outbox[0].body
        assert mail.outbox[0].to == [customer.email]

    def test_answers_are_identical_for_known_unknown_and_suspended(
        self, customer: User, make_user: Callable[..., User], send_now: Callable[[], Any]
    ) -> None:
        make_user("suspended@example.com", is_active=False)
        answers = []
        for email in ["customer@example.com", "nobody@example.com", "suspended@example.com"]:
            with send_now():
                response = forgot(APIClient(), email)
            headers = {
                k: v for k, v in response.items() if k not in {"X-Request-ID", "Date", "Vary"}
            }
            answers.append((response.status_code, response.content, headers))
        assert answers[0] == answers[1] == answers[2]
        assert len(mail.outbox) == 1  # only the active, existing account

    @override_settings(ACCOUNT_RECOVERY_MIN_RESPONSE_MS=150, EMAIL_DELIVERY="background")
    def test_response_time_does_not_reveal_the_account(
        self, customer: User, send_now: Callable[[], Any]
    ) -> None:
        # A slow mail server must not slow down only the requests for real accounts.
        def slow_delivery(_: Any) -> bool:
            time.sleep(0.4)
            return True

        timings: dict[str, list[float]] = {"known": [], "unknown": []}
        with mock.patch.object(emails, "_deliver", side_effect=slow_delivery):
            for _ in range(5):
                for kind, email in [("known", customer.email), ("unknown", "ghost@example.com")]:
                    started = time.perf_counter()
                    with send_now():
                        assert forgot(APIClient(), email).status_code == 202
                    timings[kind].append(time.perf_counter() - started)
        for samples in timings.values():
            assert min(samples) >= 0.15
        gap = abs(statistics.median(timings["known"]) - statistics.median(timings["unknown"]))
        assert gap < 0.05, timings

    def test_requests_are_audited_without_revealing_anything(self, customer: User) -> None:
        forgot(APIClient(), "customer@example.com")
        forgot(APIClient(), "ghost@example.com")
        sent = AuditLog.objects.filter(action="auth.password_reset_requested")
        assert sorted(e.changes["sent"] for e in sent) == [False, True]

    def test_inbox_budget_applies_to_every_address_alike(
        self, customer: User, send_now: Callable[[], Any]
    ) -> None:
        with send_now(), mock.patch.object(RecipientBudget, "get_rate", return_value="3/hour"):
            known = [forgot(APIClient(), customer.email).status_code for _ in range(5)]
            unknown = [forgot(APIClient(), "ghost@example.com").status_code for _ in range(5)]
        assert known == unknown == [202] * 5
        assert len(mail.outbox) == 3

    def test_per_ip_limit(self, api: APIClient) -> None:
        with mock.patch.object(AccountEmailRateThrottle, "get_rate", return_value="3/min"):
            statuses = [forgot(api, f"a{i}@example.com").status_code for i in range(5)]
        assert statuses == [202, 202, 202, 429, 429]

    def test_invalid_email_is_a_validation_error(self, api: APIClient) -> None:
        assert forgot(api, "not-an-email").status_code == 400


class TestResetPassword:
    @pytest.fixture
    def signed_in(self, customer: User) -> dict[str, Any]:
        login = APIClient().post(
            "/api/auth/login/", {"email": customer.email, "password": PASSWORD}
        )
        return {"access": login.data["access"], "refresh": login.cookies[COOKIE].value}

    def test_reset_ends_every_session_including_live_access_tokens(
        self,
        customer: User,
        signed_in: dict[str, Any],
        api: APIClient,
        send_now: Callable[[], Any],
    ) -> None:
        other_device = tokens.issue_tokens(customer)
        raw = onetime.issue(customer, TokenPurpose.RESET_PASSWORD)
        with send_now():
            response = reset(api, raw)
        assert response.status_code == 200
        customer.refresh_from_db()
        assert customer.check_password(NEW_PASSWORD)

        # Refresh tokens: blacklisted.
        assert not OutstandingToken.objects.filter(user=customer, blacklistedtoken__isnull=True)
        for refresh in [signed_in["refresh"], other_device.refresh]:
            client = APIClient()
            client.cookies[COOKIE] = refresh
            assert client.post("/api/auth/refresh/", **CSRF).status_code == 401
        # Access tokens that have not expired yet: rejected too.
        for access in [signed_in["access"], other_device.access]:
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
            denied = client.get("/api/auth/me/")
            assert denied.status_code == 401
            assert denied.data["error"]["code"] == "session_revoked"

        # The new password works, the old one does not.
        assert (
            api.post(
                "/api/auth/login/", {"email": customer.email, "password": NEW_PASSWORD}
            ).status_code
            == 200
        )
        assert (
            APIClient()
            .post("/api/auth/login/", {"email": customer.email, "password": PASSWORD})
            .status_code
            == 401
        )
        # The owner is told, and the trail is complete.
        assert [m.subject for m in mail.outbox] == ["Your SecureCart password was changed"]
        assert "#token=" not in mail.outbox[0].body
        assert AuditLog.objects.filter(action="auth.password_reset", target_id=customer.pk)

    def test_link_works_once(self, customer: User, api: APIClient) -> None:
        raw = onetime.issue(customer, TokenPurpose.RESET_PASSWORD)
        assert reset(api, raw).status_code == 200
        assert reset(api, raw, "Another-Strong-Pass-9").status_code == 400
        customer.refresh_from_db()
        assert customer.check_password(NEW_PASSWORD)

    def test_weak_password_keeps_the_link_usable(self, customer: User, api: APIClient) -> None:
        raw = onetime.issue(customer, TokenPurpose.RESET_PASSWORD)
        weak = reset(api, raw, "password123")
        assert weak.status_code == 400
        assert "new_password" in weak.data["error"]["fields"]
        assert reset(api, raw).status_code == 200

    def test_password_similar_to_the_email_is_rejected(
        self, make_user: Callable[..., User], api: APIClient
    ) -> None:
        user = make_user("ada.lovelace@example.com", full_name="Ada Lovelace")
        raw = onetime.issue(user, TokenPurpose.RESET_PASSWORD)
        assert reset(api, raw, "ada.lovelace").status_code == 400

    def test_expired_link(self, customer: User, api: APIClient) -> None:
        raw = onetime.issue(customer, TokenPurpose.RESET_PASSWORD)
        row = OneTimeToken.objects.get()
        assert row.expires_at - row.created_at == pytest.approx(
            timedelta(minutes=30), abs=timedelta(seconds=5)
        )
        OneTimeToken.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        assert reset(api, raw).status_code == 400

    def test_newer_request_supersedes_older_links(self, customer: User, api: APIClient) -> None:
        older = onetime.issue(customer, TokenPurpose.RESET_PASSWORD)
        newer = onetime.issue(customer, TokenPurpose.RESET_PASSWORD)
        assert reset(api, older).status_code == 400
        assert reset(api, newer).status_code == 200

    def test_suspended_account_cannot_reset(self, customer: User, api: APIClient) -> None:
        raw = onetime.issue(customer, TokenPurpose.RESET_PASSWORD)
        User.objects.filter(pk=customer.pk).update(is_active=False)
        assert reset(api, raw).status_code == 400

    def test_reset_confirms_the_address(self, unverified: User, api: APIClient) -> None:
        assert reset(api, onetime.issue(unverified, TokenPurpose.RESET_PASSWORD)).status_code == 200
        unverified.refresh_from_db()
        assert unverified.email_verified


class TestSessionEpoch:
    def test_refresh_token_from_an_older_epoch_cannot_rotate(self, customer: User) -> None:
        # The race the epoch closes: a rotation commits a fresh refresh token while a
        # revocation is in progress, so the token escapes the blacklist sweep.
        stale = tokens.issue_tokens(customer)
        User.objects.filter(pk=customer.pk).update(session_epoch=customer.session_epoch + 1)
        with pytest.raises(tokens.RefreshRejected, match="revoked"):
            tokens.rotate(stale.refresh)

    def test_change_password_keeps_only_the_new_session(self, customer: User) -> None:
        old = tokens.issue_tokens(customer)
        client = bearer(APIClient(), customer)
        response = client.post(
            "/api/auth/password/",
            {"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        )
        assert response.status_code == 200
        fresh = APIClient()
        fresh.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
        assert fresh.get("/api/auth/me/").status_code == 200
        stale = APIClient()
        stale.credentials(HTTP_AUTHORIZATION=f"Bearer {old.access}")
        assert stale.get("/api/auth/me/").status_code == 401

    def test_tokens_without_an_epoch_claim_still_work_until_revoked(self, customer: User) -> None:
        # Tokens issued before this release carry no claim: they count as epoch 0.
        legacy = RefreshToken.for_user(customer)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {legacy.access_token}")
        assert client.get("/api/auth/me/").status_code == 200
        tokens.revoke_all(customer)
        assert client.get("/api/auth/me/").status_code == 401

    def test_forged_epoch_claim_is_rejected(self, customer: User) -> None:
        refresh = RefreshToken.for_user(customer)
        refresh[tokens.EPOCH_CLAIM] = "0"
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")
        assert client.get("/api/auth/me/").status_code == 401


class TestDelivery:
    def test_html_escapes_user_controlled_values(self, make_user: Callable[..., User]) -> None:
        user = make_user("x@example.com", full_name='<img src=x onerror="alert(1)">')
        message = emails.verification_email(user, "secret-token")
        assert "<img src=x" not in message.html
        assert "&lt;img" in message.html

    def test_failed_sends_are_retried_then_dropped_without_logging_the_link(
        self, customer: User, caplog: pytest.LogCaptureFixture
    ) -> None:
        email = emails.password_reset_email(customer, "very-secret-value")
        with (
            mock.patch(
                "django.core.mail.EmailMultiAlternatives.send",
                side_effect=SMTPServerDisconnected("down"),
            ) as send,
            caplog.at_level("INFO", logger="securecart.email"),
        ):
            assert emails._deliver(email) is False
        assert send.call_count == settings.EMAIL_SEND_ATTEMPTS
        assert "very-secret-value" not in caplog.text
        assert "dropped" in caplog.text

    def test_transient_failure_recovers(self, customer: User) -> None:
        email = emails.verification_email(customer, "s")
        with mock.patch(
            "django.core.mail.EmailMultiAlternatives.send",
            side_effect=[OSError("reset"), 1],
        ):
            assert emails._deliver(email) is True

    def test_nothing_is_sent_when_the_transaction_rolls_back(self, customer: User) -> None:
        def doomed() -> None:
            with transaction.atomic():
                emails.send(emails.verification_email(customer, "s"))
                raise RuntimeError

        with pytest.raises(RuntimeError):
            doomed()
        assert mail.outbox == []


@contextmanager
def _settings_env(**env: str) -> Iterator[None]:
    with mock.patch.dict("os.environ", env):
        yield


class TestEmailSettings:
    def _load(self) -> Any:
        return importlib.reload(settings_module)

    def test_console_backend_is_refused_outside_debug(self) -> None:
        try:
            with (
                _settings_env(EMAIL_BACKEND="console", DJANGO_DEBUG="false"),
                pytest.raises(ImproperlyConfigured, match="reset links"),
            ):
                self._load()
        finally:
            self._load()

    def test_unknown_backend_is_refused(self) -> None:
        try:
            with _settings_env(EMAIL_BACKEND="carrier-pigeon"), pytest.raises(ImproperlyConfigured):
                self._load()
        finally:
            self._load()

    def test_tls_follows_the_port(self) -> None:
        try:
            with _settings_env(EMAIL_BACKEND="smtp", EMAIL_PORT="465"):
                module = self._load()
                assert module.EMAIL_USE_SSL
                assert not module.EMAIL_USE_TLS
            with _settings_env(EMAIL_BACKEND="smtp", EMAIL_PORT="1025"):
                module = self._load()
                assert not module.EMAIL_USE_SSL
                assert not module.EMAIL_USE_TLS
        finally:
            self._load()
