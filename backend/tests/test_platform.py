"""Security headers, error envelope, health/docs endpoints, config parsing, dashboard, seed."""

from __future__ import annotations

from io import StringIO

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.catalog.models import Product
from apps.orders.models import Order, OrderStatus
from config.env import env_bool, parse_database_url
from tests.conftest import add_to_cart, checkout

pytestmark = pytest.mark.django_db


class TestSecurityHeaders:
    def test_api_responses_carry_hardening_headers(self, api: APIClient) -> None:
        response = api.get("/api/products/")
        assert response["X-Frame-Options"] == "DENY"
        assert response["X-Content-Type-Options"] == "nosniff"
        assert response["Referrer-Policy"] == "strict-origin-when-cross-origin"
        assert response["Cross-Origin-Opener-Policy"] == "same-origin"
        assert "default-src 'self'" in response["Content-Security-Policy"]
        assert "frame-ancestors 'none'" in response["Content-Security-Policy"]
        assert "camera=()" in response["Permissions-Policy"]
        assert response["Cache-Control"] == "no-store"

    def test_request_id_is_echoed_when_safe_and_replaced_when_not(self, api: APIClient) -> None:
        assert api.get("/api/health/", HTTP_X_REQUEST_ID="abc-12345678")["X-Request-ID"] == (
            "abc-12345678"
        )
        injected = api.get("/api/health/", HTTP_X_REQUEST_ID="bad\r\nSet-Cookie: x=1")
        assert injected["X-Request-ID"] != "bad\r\nSet-Cookie: x=1"
        assert len(injected["X-Request-ID"]) == 32

    def test_cors_does_not_allow_arbitrary_origins(self, api: APIClient) -> None:
        response = api.get("/api/products/", HTTP_ORIGIN="https://evil.example.com")
        assert "Access-Control-Allow-Origin" not in response

    def test_non_json_bodies_are_rejected(self, customer_api: APIClient) -> None:
        response = customer_api.post(
            "/api/cart/items/", "product_id=1", content_type="application/x-www-form-urlencoded"
        )
        assert response.status_code == 415


class TestErrorsAndSystemEndpoints:
    def test_error_envelope(self, api: APIClient) -> None:
        response = api.get("/api/products/does-not-exist/")
        assert response.status_code == 404
        assert set(response.data["error"]) == {"code", "message"}

    def test_health(self, api: APIClient) -> None:
        assert api.get("/api/health/").data == {"status": "ok"}

    def test_openapi_schema_is_served(self, api: APIClient) -> None:
        response = api.get("/api/schema/?format=json")
        assert response.status_code == 200
        assert b'"/api/checkout/"' in response.content


class TestEnvParsing:
    def test_postgres_url(self) -> None:
        cfg = parse_database_url("postgres://app:p%40ss@db:5432/securecart?sslmode=require")
        assert cfg["ENGINE"] == "django.db.backends.postgresql"
        assert (cfg["USER"], cfg["PASSWORD"], cfg["HOST"], cfg["PORT"], cfg["NAME"]) == (
            "app",
            "p@ss",
            "db",
            "5432",
            "securecart",
        )
        assert cfg["OPTIONS"] == {"sslmode": "require"}

    def test_sqlite_url(self) -> None:
        assert parse_database_url("sqlite:///db.sqlite3")["NAME"] == "db.sqlite3"

    def test_unknown_scheme(self) -> None:
        with pytest.raises(ImproperlyConfigured):
            parse_database_url("mysql://x")

    def test_env_bool(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("FLAG", "Yes")
        assert env_bool("FLAG") is True
        monkeypatch.setenv("FLAG", "maybe")
        with pytest.raises(ImproperlyConfigured):
            env_bool("FLAG")


class TestDashboard:
    def test_kpis_count_only_captured_revenue(
        self,
        admin_api: APIClient,
        customer_api: APIClient,
        customer: User,
        product: Product,
        make_product,
    ) -> None:
        add_to_cart(customer, product, 2)  # 100.00 + 8.00 tax
        assert checkout(customer_api).status_code == 201
        add_to_cart(customer, product, 1)
        assert checkout(customer_api, token="tok_mock_decline").status_code == 402
        make_product(name="Nearly gone", stock=1)

        data = admin_api.get("/api/admin/dashboard/").data

        assert data["revenue_total"] == "108.00"
        assert data["orders_total"] == 2
        assert data["orders_by_status"]["paid"] == 1
        assert data["orders_by_status"]["payment_failed"] == 1
        assert data["customers_total"] == 1
        assert len(data["revenue_by_day"]) == 30
        assert data["revenue_by_day"][-1]["revenue"] == "108.00"
        assert data["top_products"][0] == {
            "product_id": product.id,
            "product_name": product.name,
            "units": 2,
            "revenue": "100.00",
        }
        assert [p["name"] for p in data["low_stock"]] == ["Nearly gone"]


class TestSeedDemo:
    def test_seed_is_idempotent_and_uses_real_checkout(self) -> None:
        call_command("seed_demo", "--orders=12", stdout=StringIO())
        counts = (Product.objects.count(), User.objects.count(), Order.objects.count())
        call_command("seed_demo", "--orders=12", stdout=StringIO())
        assert (Product.objects.count(), User.objects.count(), Order.objects.count()) == counts
        assert counts == (18, 7, 12)
        assert User.objects.get(email="admin@securecart.dev").role == Role.ADMIN
        assert (
            Order.objects.exclude(status=OrderStatus.PAYMENT_FAILED)
            .filter(payment_reference="")
            .count()
            == 0
        )
        assert Product.objects.get(sku="WEA-HORIZON").stock == 0
