"""Admin CSV export of orders: filters, formula-injection safety, authorization, audit."""

from __future__ import annotations

import csv
import io
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.catalog.models import Product
from apps.orders import export
from apps.orders.models import Order, OrderStatus
from tests.conftest import add_to_cart, checkout

pytestmark = pytest.mark.django_db
URL = "/api/admin/orders/export/"


def parse(response: Any) -> list[dict[str, str]]:
    body = b"".join(response.streaming_content).decode("utf-8")
    assert body.startswith("\N{ZERO WIDTH NO-BREAK SPACE}")
    return list(csv.DictReader(io.StringIO(body.lstrip("\N{ZERO WIDTH NO-BREAK SPACE}"))))


@pytest.fixture
def two_orders(
    customer: User,
    customer_api: APIClient,
    other_customer: User,
    other_api: APIClient,
    product: Product,
) -> list[Order]:
    add_to_cart(customer, product)
    first = Order.objects.get(pk=checkout(customer_api).data["id"])
    add_to_cart(other_customer, product, 2)
    second = Order.objects.get(pk=checkout(other_api).data["id"])
    Order.objects.filter(pk=second.pk).update(status=OrderStatus.SHIPPED)
    return [first, second]


class TestExport:
    def test_exports_every_order_with_totals(
        self, admin_api: APIClient, two_orders: list[Order]
    ) -> None:
        response = admin_api.get(URL)
        assert response.status_code == 200
        assert response["Content-Type"] == "text/csv; charset=utf-8"
        assert response["Content-Disposition"].startswith('attachment; filename="orders-')
        rows = parse(response)
        assert [r["number"] for r in rows] == [o.number for o in two_orders]
        first = rows[0]
        assert first["customer_email"] == "customer@example.com"
        assert first["total"] == str(two_orders[0].total)
        assert first["items"] == "1"
        assert list(rows[0]) == export.HEADER

    def test_uses_the_same_filters_as_the_list(
        self, admin_api: APIClient, two_orders: list[Order]
    ) -> None:
        shipped = parse(admin_api.get(URL, {"status": "shipped"}))
        assert [r["number"] for r in shipped] == [two_orders[1].number]
        searched = parse(admin_api.get(URL, {"search": "other@example.com"}))
        assert [r["number"] for r in searched] == [two_orders[1].number]

    def test_formulas_in_customer_data_are_neutralised(
        self, admin_api: APIClient, two_orders: list[Order]
    ) -> None:
        Order.objects.filter(pk=two_orders[0].pk).update(
            shipping_name='=HYPERLINK("https://evil.example","click")', shipping_city="+1-2"
        )
        User.objects.filter(email="customer@example.com").update(full_name="@SUM(A1:A9)")
        row = parse(admin_api.get(URL))[0]
        assert row["ship_to_name"] == '\'=HYPERLINK("https://evil.example","click")'
        assert row["ship_to_city"] == "'+1-2"
        assert row["customer_name"] == "'@SUM(A1:A9)"

    @pytest.mark.parametrize(
        ("value", "expected"),
        [("=1+1", "'=1+1"), ("-2", "'-2"), ("\tx", "'\tx"), ("plain", "plain"), (None, "")],
    )
    def test_safe_cell(self, value: Any, expected: str) -> None:
        assert export.safe_cell(value) == expected

    def test_exports_are_audited(self, admin_api: APIClient, two_orders: list[Order]) -> None:
        parse(admin_api.get(URL, {"status": "shipped"}))
        entry = AuditLog.objects.get(action="admin.orders.exported")
        assert entry.changes["rows"] == 1
        assert entry.changes["filters"] == {"status": ["shipped"]}


class TestAccess:
    def test_customers_cannot_export(
        self, customer_api: APIClient, two_orders: list[Order]
    ) -> None:
        assert customer_api.get(URL).status_code == 403

    def test_anonymous_cannot_export(self, api: APIClient) -> None:
        assert api.get(URL).status_code == 401
