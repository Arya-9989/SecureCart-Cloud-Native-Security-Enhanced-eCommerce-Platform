"""Account self-service: sign out everywhere, data export, account deletion."""

from __future__ import annotations

import json
from collections.abc import Callable

import pytest
from django.conf import settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from apps.accounts import onetime, tokens
from apps.accounts.models import OneTimeToken, TokenPurpose, User
from apps.audit.models import AuditLog
from apps.cart.models import Cart
from apps.catalog.models import Product
from apps.orders.models import Order, OrderStatus
from tests.conftest import PASSWORD, add_to_cart, bearer, checkout

pytestmark = pytest.mark.django_db

COOKIE = settings.REFRESH_COOKIE["NAME"]


def signed_in(user: User) -> tuple[APIClient, str]:
    client = APIClient()
    response = client.post("/api/auth/login/", {"email": user.email, "password": PASSWORD})
    assert response.status_code == 200
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    return client, response.cookies[COOKIE].value


@pytest.fixture
def delivered_order(customer: User, customer_api: APIClient, product: Product) -> Order:
    add_to_cart(customer, product)
    order = Order.objects.get(pk=checkout(customer_api).data["id"])
    Order.objects.filter(pk=order.pk).update(status=OrderStatus.DELIVERED)
    return order


class TestSignOutEverywhere:
    def test_ends_every_session_including_this_one(self, customer: User) -> None:
        here, _ = signed_in(customer)
        elsewhere, elsewhere_cookie = signed_in(customer)
        response = here.post("/api/auth/sessions/revoke/")
        assert response.status_code == 204
        assert response.cookies[COOKIE].value == ""  # this browser's cookie is cleared
        assert here.get("/api/auth/me/").status_code == 401
        assert elsewhere.get("/api/auth/me/").status_code == 401
        refresh = APIClient()
        refresh.cookies[COOKIE] = elsewhere_cookie
        assert refresh.post("/api/auth/refresh/", HTTP_X_CSRF_PROTECTION="1").status_code == 401
        assert AuditLog.objects.filter(action="auth.sessions_revoked", target_id=customer.pk)

    def test_requires_a_session(self, api: APIClient) -> None:
        assert api.post("/api/auth/sessions/revoke/").status_code == 401


class TestExport:
    def test_contains_my_data_and_nobody_elses(
        self,
        customer: User,
        customer_api: APIClient,
        other_customer: User,
        other_api: APIClient,
        make_product: Callable[..., Product],
    ) -> None:
        add_to_cart(customer, make_product(name="Mine", sku="MINE-1"))
        checkout(customer_api)
        add_to_cart(other_customer, make_product(name="Theirs", sku="THEIRS-1"))
        checkout(other_api)
        add_to_cart(customer, make_product(name="In my bag", sku="BAG-1"), 2)

        response = customer_api.get("/api/auth/me/export/")
        assert response.status_code == 200
        assert response["Content-Disposition"].startswith('attachment; filename="securecart-data-')
        assert response["Cache-Control"] == "no-store"
        data = json.loads(response.content)
        assert data["profile"]["email"] == customer.email
        assert [o["items"][0]["name"] for o in data["orders"]] == ["Mine"]
        assert data["orders"][0]["shipping_address"]["city"] == "London"
        assert data["bag"] == [{"sku": "BAG-1", "name": "In my bag", "quantity": 2}]
        assert "Theirs" not in response.content.decode()
        assert other_customer.email not in response.content.decode()
        assert AuditLog.objects.filter(action="auth.data_exported", target_id=customer.pk)

    def test_includes_my_sign_in_activity(self, customer: User) -> None:
        client, _ = signed_in(customer)
        activity = json.loads(client.get("/api/auth/me/export/").content)["account_activity"]
        assert "auth.login" in [a["action"] for a in activity]

    def test_requires_a_session(self, api: APIClient) -> None:
        assert api.get("/api/auth/me/export/").status_code == 401


class TestDeleteAccount:
    def test_anonymises_the_account_and_keeps_orders(
        self, customer: User, delivered_order: Order, product: Product
    ) -> None:
        client, cookie = signed_in(customer)
        add_to_cart(customer, product)
        onetime.issue(customer, TokenPurpose.RESET_PASSWORD)
        original_email = customer.email

        response = client.post("/api/auth/me/delete/", {"password": PASSWORD})
        assert response.status_code == 204
        customer.refresh_from_db()
        assert customer.email.startswith("deleted-")
        assert customer.email.endswith("@deleted.invalid")
        assert customer.full_name == "Deleted account"
        assert not customer.is_active
        assert not customer.has_usable_password()
        assert not Cart.objects.filter(user=customer).exists()
        assert not OneTimeToken.objects.filter(user=customer).exists()
        assert not OutstandingToken.objects.filter(user=customer).exists()
        # The order stays for accounting, attached to the anonymised account.
        delivered_order.refresh_from_db()
        assert delivered_order.user_id == customer.pk

        # Every session is gone and the old credentials no longer sign in.
        assert client.get("/api/auth/me/").status_code == 401
        refresh = APIClient()
        refresh.cookies[COOKIE] = cookie
        assert refresh.post("/api/auth/refresh/", HTTP_X_CSRF_PROTECTION="1").status_code == 401
        login = APIClient().post(
            "/api/auth/login/", {"email": original_email, "password": PASSWORD}
        )
        assert login.status_code == 401
        entry = AuditLog.objects.get(action="auth.account_deleted")
        assert original_email not in json.dumps(entry.changes)
        assert entry.actor_email == customer.email  # the anonymised address

    def test_the_address_can_be_used_again(self, customer: User, api: APIClient) -> None:
        client, _ = signed_in(customer)
        client.post("/api/auth/me/delete/", {"password": PASSWORD})
        response = api.post(
            "/api/auth/register/",
            {"email": "customer@example.com", "full_name": "Fresh Start", "password": PASSWORD},
        )
        assert response.status_code == 201

    def test_wrong_password_changes_nothing(self, customer: User, customer_api: APIClient) -> None:
        response = customer_api.post("/api/auth/me/delete/", {"password": "not-my-password"})
        assert response.status_code == 400
        customer.refresh_from_db()
        assert customer.is_active
        assert customer.email == "customer@example.com"

    @pytest.mark.parametrize(
        "status", [OrderStatus.PENDING_PAYMENT, OrderStatus.PAID, OrderStatus.SHIPPED]
    )
    def test_refused_while_an_order_is_open(
        self, customer: User, customer_api: APIClient, delivered_order: Order, status: str
    ) -> None:
        Order.objects.filter(pk=delivered_order.pk).update(status=status)
        response = customer_api.post("/api/auth/me/delete/", {"password": PASSWORD})
        assert response.status_code == 409
        assert response.data["error"]["code"] == "open_orders"
        customer.refresh_from_db()
        assert customer.is_active

    def test_administrators_cannot_delete_themselves(
        self, admin: User, admin_api: APIClient
    ) -> None:
        response = admin_api.post("/api/auth/me/delete/", {"password": PASSWORD})
        assert response.status_code == 409
        assert response.data["error"]["code"] == "admin_account"
        admin.refresh_from_db()
        assert admin.is_active

    def test_requires_a_session(self, api: APIClient) -> None:
        assert api.post("/api/auth/me/delete/", {"password": PASSWORD}).status_code == 401

    def test_a_stolen_access_token_alone_cannot_delete(self, customer: User) -> None:
        # The password is required in addition to the bearer token.
        thief = bearer(APIClient(), customer)
        assert thief.post("/api/auth/me/delete/", {}).status_code == 400
        customer.refresh_from_db()
        assert customer.is_active

    def test_epoch_bump_also_kills_other_access_tokens(self, customer: User) -> None:
        other = tokens.issue_tokens(customer)
        client, _ = signed_in(customer)
        client.post("/api/auth/me/delete/", {"password": PASSWORD})
        stale = APIClient()
        stale.credentials(HTTP_AUTHORIZATION=f"Bearer {other.access}")
        assert stale.get("/api/auth/me/").status_code == 401
