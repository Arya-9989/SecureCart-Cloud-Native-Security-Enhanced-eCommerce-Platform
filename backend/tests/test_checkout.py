from __future__ import annotations

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.cart.models import CartItem
from apps.catalog.models import Product
from apps.orders.models import Order, OrderStatus
from apps.payments.providers.mock import DECLINE_TOKEN
from tests.conftest import ADDRESS, add_to_cart, checkout

pytestmark = pytest.mark.django_db


class TestSuccessfulCheckout:
    def test_creates_paid_order_reserves_stock_and_empties_cart(
        self, customer_api: APIClient, customer: User, product: Product, make_product
    ) -> None:
        mug = make_product(name="Mug", price="12.50", stock=4)
        add_to_cart(customer, product, 2)
        add_to_cart(customer, mug, 1)

        response = checkout(customer_api)

        assert response.status_code == 201, response.data
        order = Order.objects.get(pk=response.data["id"])
        assert order.status == OrderStatus.PAID
        assert order.payment_reference.startswith("mock_ch_")
        assert order.subtotal == Decimal("112.50")
        assert order.shipping == Decimal("0.00")  # above free-shipping threshold
        assert order.total == order.subtotal + order.shipping + order.tax
        assert order.shipping_country == "GB"
        product.refresh_from_db()
        mug.refresh_from_db()
        assert (product.stock, mug.stock) == (8, 3)
        assert not CartItem.objects.filter(cart__user=customer).exists()
        assert [e["to_status"] for e in response.data["events"]] == ["pending_payment", "paid"]

    def test_line_items_snapshot_price_and_name(
        self, customer_api: APIClient, customer: User, product: Product
    ) -> None:
        add_to_cart(customer, product, 1)
        order_id = checkout(customer_api).data["id"]
        Product.objects.filter(pk=product.pk).update(price="99.00", name="Renamed")
        item = customer_api.get(f"/api/orders/{order_id}/").data["items"][0]
        assert item["unit_price"] == "50.00"
        assert item["product_name"] == "Aurora Headphones"

    def test_order_history_lists_orders_newest_first(
        self, customer_api: APIClient, customer: User, product: Product
    ) -> None:
        for _ in range(2):
            add_to_cart(customer, product, 1)
            assert checkout(customer_api).status_code == 201
        data = customer_api.get("/api/orders/").data
        assert data["count"] == 2
        assert data["results"][0]["created_at"] >= data["results"][1]["created_at"]
        assert data["results"][0]["item_count"] == 1


class TestIdempotency:
    def test_retry_with_same_key_returns_original_order_without_recharging(
        self, customer_api: APIClient, customer: User, product: Product
    ) -> None:
        add_to_cart(customer, product, 1)
        first = checkout(customer_api, key="attempt-0001")
        add_to_cart(customer, product, 1)  # cart changes between retries
        second = checkout(customer_api, key="attempt-0001")

        assert first.status_code == 201
        assert second.status_code == 200
        assert first.data["id"] == second.data["id"]
        assert Order.objects.count() == 1
        product.refresh_from_db()
        assert product.stock == 9

    def test_same_key_from_different_users_is_independent(
        self, customer_api, other_api, customer, other_customer, product
    ) -> None:
        add_to_cart(customer, product)
        add_to_cart(other_customer, product)
        assert checkout(customer_api, key="shared-key-1").status_code == 201
        assert checkout(other_api, key="shared-key-1").status_code == 201

    @pytest.mark.parametrize("key", ["", "short", "has spaces in it", "x" * 65])
    def test_key_is_required_and_validated(self, customer_api, customer, product, key) -> None:
        add_to_cart(customer, product)
        response = customer_api.post(
            "/api/checkout/",
            {"shipping_address": {}, "payment_token": "x"},
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
        )
        assert response.status_code == 400
        assert "idempotency_key" in response.data["error"]["fields"]


class TestCheckoutFailures:
    def test_insufficient_stock_changes_nothing(
        self, customer_api: APIClient, customer: User, product: Product, make_product
    ) -> None:
        scarce = make_product(name="Scarce", stock=5)
        add_to_cart(customer, product, 1)
        add_to_cart(customer, scarce, 5)
        Product.objects.filter(pk=scarce.pk).update(stock=2)  # someone else bought some

        response = checkout(customer_api)

        assert response.status_code == 409
        assert response.data["error"]["code"] == "insufficient_stock"
        assert response.data["error"]["items"] == [
            {"product_id": scarce.id, "name": "Scarce", "requested": 5, "available": 2}
        ]
        assert Order.objects.count() == 0
        product.refresh_from_db()
        assert product.stock == 10  # the in-stock line was not reserved either
        assert CartItem.objects.filter(cart__user=customer).count() == 2

    def test_deactivated_product_blocks_checkout(
        self, customer_api: APIClient, customer: User, product: Product
    ) -> None:
        add_to_cart(customer, product, 1)
        Product.objects.filter(pk=product.pk).update(is_active=False)
        response = checkout(customer_api)
        assert response.status_code == 409
        assert response.data["error"]["items"][0]["available"] == 0

    def test_empty_cart(self, customer_api: APIClient) -> None:
        response = checkout(customer_api)
        assert response.status_code == 409
        assert response.data["error"]["code"] == "empty_cart"

    def test_declined_payment_releases_stock_and_keeps_cart(
        self, customer_api: APIClient, customer: User, product: Product
    ) -> None:
        add_to_cart(customer, product, 3)
        response = checkout(customer_api, token=DECLINE_TOKEN)

        assert response.status_code == 402
        assert response.data["error"]["code"] == "payment_declined"
        order = Order.objects.get(pk=response.data["error"]["order_id"])
        assert order.status == OrderStatus.PAYMENT_FAILED
        assert order.failure_reason
        product.refresh_from_db()
        assert product.stock == 10
        assert CartItem.objects.get(cart__user=customer).quantity == 3

    def test_unknown_payment_token_is_declined(
        self, customer_api: APIClient, customer: User, product: Product
    ) -> None:
        add_to_cart(customer, product, 1)
        assert checkout(customer_api, token="tok_made_up").status_code == 402

    @pytest.mark.parametrize(
        ("field", "value"),
        [("country", "GBR"), ("postal_code", "<script>"), ("name", ""), ("line1", "x")],
    )
    def test_validates_shipping_address(
        self, customer_api: APIClient, customer: User, product: Product, field: str, value: str
    ) -> None:
        add_to_cart(customer, product, 1)
        response = checkout(customer_api, shipping_address={**ADDRESS, field: value})
        assert response.status_code == 400
        assert field in response.data["error"]["fields"]["shipping_address"]
        assert Order.objects.count() == 0

    def test_requires_authentication(self, api: APIClient) -> None:
        assert checkout(api).status_code == 401
