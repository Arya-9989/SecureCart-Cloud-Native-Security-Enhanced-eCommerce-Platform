"""Authorization: role-based access to admin endpoints and per-user object isolation."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.catalog.models import Product
from apps.orders.models import Order, OrderStatus
from tests.conftest import add_to_cart, bearer, checkout

pytestmark = pytest.mark.django_db

ADMIN_READ_ENDPOINTS = [
    "/api/admin/dashboard/",
    "/api/admin/products/",
    "/api/admin/categories/",
    "/api/admin/orders/",
    "/api/admin/users/",
    "/api/admin/audit-logs/",
]


@pytest.mark.parametrize("url", ADMIN_READ_ENDPOINTS)
class TestAdminEndpoints:
    def test_anonymous_is_unauthorized(self, api: APIClient, url: str) -> None:
        assert api.get(url).status_code == 401

    def test_customer_is_forbidden(self, customer_api: APIClient, url: str) -> None:
        response = customer_api.get(url)
        assert response.status_code == 403
        assert response.data["error"]["message"] == "Administrator role required."

    def test_admin_is_allowed(self, admin_api: APIClient, url: str) -> None:
        assert admin_api.get(url).status_code == 200


class TestAdminWritesForbiddenForCustomers:
    def test_cannot_create_product(self, customer_api: APIClient, category) -> None:
        response = customer_api.post(
            "/api/admin/products/",
            {"name": "Hack", "sku": "HACK-1", "price": "1.00", "category_id": category.id},
        )
        assert response.status_code == 403
        assert not Product.objects.filter(sku="HACK-1").exists()

    def test_cannot_change_stock_or_delete(self, customer_api: APIClient, product) -> None:
        assert (
            customer_api.patch(f"/api/admin/products/{product.id}/", {"stock": 9999}).status_code
            == 403
        )
        assert customer_api.delete(f"/api/admin/products/{product.id}/").status_code == 403
        product.refresh_from_db()
        assert product.stock == 10

    def test_cannot_promote_self(self, customer_api: APIClient, customer: User) -> None:
        response = customer_api.patch(f"/api/admin/users/{customer.id}/", {"role": "admin"})
        assert response.status_code == 403
        customer.refresh_from_db()
        assert customer.role == Role.CUSTOMER

    def test_cannot_transition_orders(
        self, customer_api: APIClient, customer: User, product: Product
    ) -> None:
        add_to_cart(customer, product)
        order_id = checkout(customer_api).data["id"]
        response = customer_api.post(
            f"/api/admin/orders/{order_id}/transition/", {"status": "shipped"}
        )
        assert response.status_code == 403
        assert Order.objects.get(pk=order_id).status == OrderStatus.PAID


class TestRoleChangesTakeEffectImmediately:
    def test_demoted_admin_loses_access_with_existing_token(
        self, admin_api: APIClient, admin: User
    ) -> None:
        assert admin_api.get("/api/admin/users/").status_code == 200
        User.objects.filter(pk=admin.pk).update(role=Role.CUSTOMER)
        assert admin_api.get("/api/admin/users/").status_code == 403

    def test_admin_can_promote_and_change_is_audited(
        self, admin_api: APIClient, customer: User
    ) -> None:
        response = admin_api.patch(f"/api/admin/users/{customer.id}/", {"role": "admin"})
        assert response.status_code == 200
        customer.refresh_from_db()
        assert customer.role == Role.ADMIN
        log = admin_api.get("/api/admin/audit-logs/?action=admin.user").data["results"][0]
        assert log["changes"] == {"role": ["customer", "admin"]}
        assert log["actor_email"] == "admin@example.com"

    def test_admin_cannot_demote_or_deactivate_self(
        self, admin_api: APIClient, admin: User
    ) -> None:
        assert (
            admin_api.patch(f"/api/admin/users/{admin.id}/", {"role": "customer"}).status_code
            == 400
        )
        assert (
            admin_api.patch(f"/api/admin/users/{admin.id}/", {"is_active": False}).status_code
            == 400
        )
        admin.refresh_from_db()
        assert admin.role == Role.ADMIN
        assert admin.is_active

    def test_deactivating_a_user_blocks_their_access(
        self, admin_api: APIClient, customer: User
    ) -> None:
        customer_api = bearer(APIClient(), customer)
        assert (
            admin_api.patch(f"/api/admin/users/{customer.id}/", {"is_active": False}).status_code
            == 200
        )
        assert customer_api.get("/api/auth/me/").status_code == 401

    def test_email_is_read_only_for_admins(self, admin_api: APIClient, customer: User) -> None:
        admin_api.patch(f"/api/admin/users/{customer.id}/", {"email": "hijack@example.com"})
        customer.refresh_from_db()
        assert customer.email == "customer@example.com"


class TestOrderIsolation:
    @pytest.fixture
    def victims_order(self, other_api: APIClient, other_customer: User, product: Product) -> str:
        add_to_cart(other_customer, product)
        response = checkout(other_api)
        assert response.status_code == 201
        return str(response.data["id"])

    def test_cannot_read_another_users_order(
        self, customer_api: APIClient, victims_order: str
    ) -> None:
        assert customer_api.get(f"/api/orders/{victims_order}/").status_code == 404

    def test_order_list_contains_only_own_orders(
        self, customer_api: APIClient, other_api: APIClient, victims_order: str
    ) -> None:
        assert customer_api.get("/api/orders/").data["count"] == 0
        assert other_api.get("/api/orders/").data["count"] == 1

    def test_cannot_cancel_another_users_order(
        self, customer_api: APIClient, victims_order: str
    ) -> None:
        assert customer_api.post(f"/api/orders/{victims_order}/cancel/").status_code == 404
        assert Order.objects.get(pk=victims_order).status == OrderStatus.PAID

    def test_admin_can_see_every_order(self, admin_api: APIClient, victims_order: str) -> None:
        response = admin_api.get(f"/api/admin/orders/{victims_order}/")
        assert response.status_code == 200
        assert response.data["customer_email"] == "other@example.com"

    def test_anonymous_cannot_list_orders(self, api: APIClient) -> None:
        assert api.get("/api/orders/").status_code == 401


class TestCartIsolation:
    def test_cannot_modify_or_delete_another_users_cart_item(
        self, customer_api: APIClient, other_customer: User, product: Product
    ) -> None:
        item = add_to_cart(other_customer, product, 1)
        assert customer_api.patch(f"/api/cart/items/{item.id}/", {"quantity": 5}).status_code == 404
        assert customer_api.delete(f"/api/cart/items/{item.id}/").status_code == 404
        item.refresh_from_db()
        assert item.quantity == 1

    def test_cart_requires_authentication(self, api: APIClient) -> None:
        assert api.get("/api/cart/").status_code == 401
