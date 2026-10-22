from __future__ import annotations

from decimal import Decimal

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.catalog.models import Product
from apps.orders.pricing import compute_totals

pytestmark = pytest.mark.django_db


def add(client: APIClient, product: Product, quantity: int = 1):
    return client.post("/api/cart/items/", {"product_id": product.id, "quantity": quantity})


class TestCart:
    def test_empty_cart(self, customer_api: APIClient) -> None:
        data = customer_api.get("/api/cart/").data
        assert data["items"] == []
        assert data["total"] == "0.00"

    def test_add_and_increment(self, customer_api: APIClient, product: Product) -> None:
        assert add(customer_api, product, 2).status_code == 201
        data = add(customer_api, product, 1).data
        assert len(data["items"]) == 1
        assert data["items"][0]["quantity"] == 3
        assert data["item_count"] == 3
        assert data["subtotal"] == "150.00"

    def test_cannot_exceed_stock(self, customer_api: APIClient, make_product) -> None:
        scarce = make_product(stock=2)
        response = add(customer_api, scarce, 3)
        assert response.status_code == 400
        assert "Only 2 available" in str(response.data["error"]["fields"]["quantity"])

    def test_cannot_add_out_of_stock_or_inactive(self, customer_api, make_product) -> None:
        assert add(customer_api, make_product(stock=0)).status_code == 400
        assert add(customer_api, make_product(is_active=False)).status_code == 400

    def test_line_quantity_is_capped(self, customer_api: APIClient, make_product) -> None:
        plenty = make_product(stock=500)
        assert add(customer_api, plenty, 11).status_code == 400

    @pytest.mark.parametrize("quantity", [0, -1, "two"])
    def test_rejects_invalid_quantity(self, customer_api, product, quantity) -> None:
        assert add(customer_api, product, quantity).status_code == 400

    def test_unknown_product(self, customer_api: APIClient) -> None:
        response = customer_api.post("/api/cart/items/", {"product_id": 99999})
        assert response.status_code == 400

    def test_update_and_remove(self, customer_api: APIClient, product: Product) -> None:
        item_id = add(customer_api, product).data["items"][0]["id"]
        updated = customer_api.patch(f"/api/cart/items/{item_id}/", {"quantity": 4})
        assert updated.data["items"][0]["quantity"] == 4
        removed = customer_api.delete(f"/api/cart/items/{item_id}/")
        assert removed.data["items"] == []

    def test_clear(self, customer_api: APIClient, product: Product) -> None:
        add(customer_api, product)
        assert customer_api.delete("/api/cart/").status_code == 204
        assert customer_api.get("/api/cart/").data["items"] == []

    def test_flags_items_that_became_unavailable(
        self, customer_api: APIClient, product: Product
    ) -> None:
        add(customer_api, product, 3)
        Product.objects.filter(pk=product.pk).update(stock=1)
        assert customer_api.get("/api/cart/").data["items"][0]["is_available"] is False


class TestPricing:
    @override_settings(FREE_SHIPPING_THRESHOLD="75.00", FLAT_SHIPPING_FEE="6.99", TAX_RATE="0.08")
    def test_flat_shipping_below_threshold(self) -> None:
        totals = compute_totals(Decimal("50.00"))
        assert (totals.shipping, totals.tax, totals.total) == (
            Decimal("6.99"),
            Decimal("4.00"),
            Decimal("60.99"),
        )

    @override_settings(FREE_SHIPPING_THRESHOLD="75.00", TAX_RATE="0.08")
    def test_free_shipping_at_threshold(self) -> None:
        totals = compute_totals(Decimal("75.00"))
        assert totals.shipping == Decimal("0.00")
        assert totals.total == Decimal("81.00")

    @override_settings(TAX_RATE="0.0825")
    def test_tax_rounds_half_up_to_cents(self) -> None:
        assert compute_totals(Decimal("10.10")).tax == Decimal("0.83")  # 0.83325

    def test_empty_subtotal_is_free(self) -> None:
        assert compute_totals(Decimal("0")).total == Decimal("0.00")
