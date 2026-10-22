from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.catalog.models import Category, Product
from tests.conftest import add_to_cart, checkout

pytestmark = pytest.mark.django_db


@pytest.fixture
def catalog(make_product: Callable[..., Product]) -> dict[str, Product]:
    home = Category.objects.create(name="Home", slug="home")
    return {
        "lamp": make_product(
            name="Halo Lamp",
            category=home,
            price="74.00",
            stock=5,
            description="Warm dimmable light",
        ),
        "mug": make_product(name="Terra Mug", category=home, price="12.00", stock=0),
        "headphones": make_product(
            name="Aurora Headphones", price="189.00", stock=3, is_featured=True
        ),
        "hidden": make_product(name="Secret Prototype", price="999.00", is_active=False),
    }


def names(response) -> set[str]:
    return {p["name"] for p in response.data["results"]}


class TestStorefrontCatalog:
    def test_lists_only_active_products_publicly(self, api: APIClient, catalog) -> None:
        response = api.get("/api/products/")
        assert response.status_code == 200
        assert names(response) == {"Halo Lamp", "Terra Mug", "Aurora Headphones"}

    def test_inactive_product_detail_is_404(self, api: APIClient, catalog) -> None:
        assert api.get(f"/api/products/{catalog['hidden'].slug}/").status_code == 404
        assert api.get(f"/api/products/{catalog['lamp'].slug}/").status_code == 200

    def test_search_matches_name_and_description(self, api: APIClient, catalog) -> None:
        assert names(api.get("/api/products/?search=aurora")) == {"Aurora Headphones"}
        assert names(api.get("/api/products/?search=dimmable")) == {"Halo Lamp"}
        assert names(api.get("/api/products/?search=prototype")) == set()

    def test_filter_by_category_price_and_stock(self, api: APIClient, catalog) -> None:
        assert names(api.get("/api/products/?category=home")) == {"Halo Lamp", "Terra Mug"}
        assert names(api.get("/api/products/?min_price=50&max_price=100")) == {"Halo Lamp"}
        assert names(api.get("/api/products/?in_stock=true")) == {"Halo Lamp", "Aurora Headphones"}
        assert names(api.get("/api/products/?in_stock=false")) == {"Terra Mug"}

    def test_ordering_by_price(self, api: APIClient, catalog) -> None:
        prices = [
            Decimal(p["price"]) for p in api.get("/api/products/?ordering=-price").data["results"]
        ]
        assert prices == sorted(prices, reverse=True)

    def test_invalid_filter_value_is_a_client_error(self, api: APIClient, catalog) -> None:
        assert api.get("/api/products/?min_price=abc").status_code == 400

    def test_categories_report_active_product_counts(self, api: APIClient, catalog) -> None:
        counts = {c["slug"]: c["product_count"] for c in api.get("/api/categories/").data}
        assert counts == {"audio": 1, "home": 2}

    def test_page_size_is_capped(self, api: APIClient, catalog) -> None:
        response = api.get("/api/products/?page_size=100000")
        assert response.status_code == 200
        assert len(response.data["results"]) <= 100


class TestAdminProductManagement:
    def payload(self, category: Category, **overrides) -> dict[str, object]:
        return {
            "name": "Pulse Speaker",
            "sku": "aud-pulse",
            "price": "59.00",
            "stock": 12,
            "category_id": category.id,
            "image_url": "/products/pulse.svg",
            **overrides,
        }

    def test_create_generates_slug_normalises_sku_and_audits(
        self, admin_api: APIClient, category: Category
    ) -> None:
        response = admin_api.post("/api/admin/products/", self.payload(category))
        assert response.status_code == 201, response.data
        assert response.data["slug"] == "pulse-speaker"
        assert response.data["sku"] == "AUD-PULSE"
        log = AuditLog.objects.get(action="admin.product.created")
        assert log.actor_email == "admin@example.com"
        assert log.target_id == str(response.data["id"])

    def test_duplicate_names_get_unique_slugs(
        self, admin_api: APIClient, category: Category
    ) -> None:
        admin_api.post("/api/admin/products/", self.payload(category))
        response = admin_api.post("/api/admin/products/", self.payload(category, sku="AUD-2"))
        assert response.data["slug"] == "pulse-speaker-2"

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("price", "-1.00"),
            ("price", "0"),
            ("stock", -5),
            ("sku", "bad sku!"),
            ("image_url", "javascript:alert(1)"),
            ("image_url", "//evil.example.com/x.png"),
            ("image_url", "http://insecure.example.com/x.png"),
            ("name", " "),
        ],
    )
    def test_rejects_invalid_input(
        self, admin_api: APIClient, category: Category, field: str, value
    ) -> None:
        response = admin_api.post("/api/admin/products/", self.payload(category, **{field: value}))
        assert response.status_code == 400
        assert field in response.data["error"]["fields"]

    def test_update_records_field_diff(self, admin_api: APIClient, product: Product) -> None:
        response = admin_api.patch(
            f"/api/admin/products/{product.id}/", {"stock": 3, "price": "45.00"}
        )
        assert response.status_code == 200
        log = AuditLog.objects.get(action="admin.product.updated")
        assert log.changes == {"price": ["50.00", "45.00"], "stock": [10, 3]}

    def test_admin_sees_inactive_products(self, admin_api: APIClient, catalog) -> None:
        response = admin_api.get("/api/admin/products/?is_active=false")
        assert [p["name"] for p in response.data["results"]] == ["Secret Prototype"]

    def test_delete_product_without_orders(self, admin_api: APIClient, product: Product) -> None:
        assert admin_api.delete(f"/api/admin/products/{product.id}/").status_code == 204
        assert not Product.objects.filter(pk=product.pk).exists()
        assert AuditLog.objects.filter(
            action="admin.product.deleted", target_id=str(product.pk)
        ).exists()

    def test_delete_product_with_order_history_is_refused(
        self, admin_api: APIClient, customer_api: APIClient, customer, product: Product
    ) -> None:
        add_to_cart(customer, product)
        assert checkout(customer_api).status_code == 201
        response = admin_api.delete(f"/api/admin/products/{product.id}/")
        assert response.status_code == 409
        assert Product.objects.filter(pk=product.pk).exists()

    def test_delete_category_in_use_is_refused(
        self, admin_api: APIClient, product: Product
    ) -> None:
        assert admin_api.delete(f"/api/admin/categories/{product.category_id}/").status_code == 409

    def test_category_crud(self, admin_api: APIClient) -> None:
        created = admin_api.post("/api/admin/categories/", {"name": "Garden Tools"})
        assert created.status_code == 201
        assert created.data["slug"] == "garden-tools"
        cid = created.data["id"]
        assert (
            admin_api.patch(f"/api/admin/categories/{cid}/", {"name": "Garden"}).status_code == 200
        )
        assert admin_api.delete(f"/api/admin/categories/{cid}/").status_code == 204
        actions = set(AuditLog.objects.values_list("action", flat=True))
        assert {
            "admin.category.created",
            "admin.category.updated",
            "admin.category.deleted",
        } <= actions
