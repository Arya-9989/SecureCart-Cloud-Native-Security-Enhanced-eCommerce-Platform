"""Invoice PDFs: correct figures, currency formatting, and access only for owner and admins."""

from __future__ import annotations

import io
import re
from collections.abc import Callable
from decimal import Decimal
from typing import Any

import pytest
from django.utils import timezone
from pypdf import PdfReader
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import Product
from apps.orders import invoice
from apps.orders.models import Order, OrderStatus
from tests.conftest import add_to_cart, checkout

pytestmark = pytest.mark.django_db

EURO, POUND, YEN, NBSP = "€", "£", "¥", "\u00a0"


def pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def amount(text: str, label: str) -> str:
    match = re.search(rf"{re.escape(label)}\s*(\S+)", text)
    assert match, f"{label!r} not found in:\n{text}"
    return match.group(1)


@pytest.fixture
def paid_order(
    customer: User, customer_api: APIClient, make_product: Callable[..., Product]
) -> Order:
    # 3 x 19.99 + 1 x 7.45 = 67.42: under the free-shipping threshold, and the tax rounds.
    add_to_cart(customer, make_product(name="Linen Notebook", sku="NB-1", price="19.99"), 3)
    add_to_cart(customer, make_product(name="Ceramic Mug", sku="MUG-1", price="7.45"), 1)
    response = checkout(customer_api)
    assert response.status_code == 201
    return Order.objects.get(pk=response.data["id"])


class TestContent:
    def test_figures_match_the_order_and_add_up(self, paid_order: Order) -> None:
        text = pdf_text(invoice.render(paid_order))
        assert f"Invoice no. {paid_order.number}" in text
        assert "Linen Notebook" in text
        assert "NB-1" in text
        assert "$19.99" in text
        assert "$59.97" in text  # 3 x 19.99
        assert "$7.45" in text
        assert amount(text, "Subtotal") == "$67.42"
        assert amount(text, "Shipping") == "$6.99"
        assert amount(text, "Tax (8%)") == "$5.39"  # 67.42 x 0.08 = 5.3936
        assert amount(text, "Total") == "$79.80"
        assert paid_order.subtotal + paid_order.shipping + paid_order.tax == paid_order.total
        assert paid_order.total == Decimal("79.80")
        assert "Ada Lovelace" in text
        assert "customer@example.com" in text
        assert "Amounts in USD" in text

    def test_free_shipping_is_printed_as_free(
        self, customer: User, customer_api: APIClient, make_product: Callable[..., Product]
    ) -> None:
        add_to_cart(customer, make_product(price="80.00"))
        order = Order.objects.get(pk=checkout(customer_api).data["id"])
        assert amount(pdf_text(invoice.render(order)), "Shipping") == "Free"

    def test_invoice_uses_the_snapshot_not_the_current_catalog(self, paid_order: Order) -> None:
        Product.objects.filter(sku="NB-1").update(name="Renamed", price=Decimal("99.00"))
        text = pdf_text(invoice.render(paid_order))
        assert "Linen Notebook" in text
        assert "Renamed" not in text
        assert "$99.00" not in text

    def test_markup_in_customer_text_stays_text(self, paid_order: Order) -> None:
        Order.objects.filter(pk=paid_order.pk).update(shipping_name="<b>Eve</b> & <i>co</i>")
        paid_order.refresh_from_db()
        assert "<b>Eve</b> & <i>co</i>" in pdf_text(invoice.render(paid_order))

    def test_older_orders_without_a_recorded_rate_say_tax(self, paid_order: Order) -> None:
        Order.objects.filter(pk=paid_order.pk).update(tax_rate=None)
        paid_order.refresh_from_db()
        text = pdf_text(invoice.render(paid_order))
        assert "Tax (" not in text
        assert amount(text, "Tax") == "$5.39"

    def test_refunded_orders_say_so(self, paid_order: Order) -> None:
        Order.objects.filter(pk=paid_order.pk).update(
            status=OrderStatus.CANCELLED, cancelled_at=timezone.now()
        )
        paid_order.refresh_from_db()
        assert "the payment was refunded" in pdf_text(invoice.render(paid_order))

    def test_document_metadata(self, paid_order: Order) -> None:
        reader = PdfReader(io.BytesIO(invoice.render(paid_order)))
        assert reader.metadata is not None
        assert reader.metadata.title == f"Invoice {paid_order.number}"
        assert len(reader.pages) == 1

    def test_unpaid_orders_have_no_invoice(self, paid_order: Order) -> None:
        Order.objects.filter(pk=paid_order.pk).update(paid_at=None)
        paid_order.refresh_from_db()
        with pytest.raises(invoice.InvoiceUnavailable):
            invoice.render(paid_order)


class TestCurrencyFormatting:
    @pytest.mark.parametrize(
        ("value", "currency", "expected"),
        [
            ("1234.50", "USD", "$1,234.50"),
            ("1234.50", "EUR", f"{EURO}1,234.50"),
            ("1234.50", "GBP", f"{POUND}1,234.50"),
            ("1235", "JPY", f"{YEN}1,235"),
            ("0.05", "USD", "$0.05"),
            ("1234567.89", "USD", "$1,234,567.89"),
            # The standard PDF fonts cannot draw the rupee sign: the ISO code is used instead.
            ("1234.50", "INR", f"INR{NBSP}1,234.50"),
        ],
    )
    def test_money(self, value: str, currency: str, expected: str) -> None:
        assert invoice.money(Decimal(value), currency) == expected

    def test_a_euro_order_prints_euros(self, paid_order: Order) -> None:
        Order.objects.filter(pk=paid_order.pk).update(currency="EUR")
        paid_order.refresh_from_db()
        text = pdf_text(invoice.render(paid_order))
        assert amount(text, "Total") == f"{EURO}79.80"
        assert "Amounts in EUR" in text


class TestAccess:
    URL = "/api/orders/{}/invoice/"

    def test_owner_downloads_a_pdf(self, customer_api: APIClient, paid_order: Order) -> None:
        response = customer_api.get(self.URL.format(paid_order.pk))
        assert response.status_code == 200
        assert response["Content-Type"] == "application/pdf"
        assert response["Content-Disposition"] == (
            f'attachment; filename="invoice-{paid_order.number}.pdf"'
        )
        assert response["X-Content-Type-Options"] == "nosniff"
        assert response["Cache-Control"] == "no-store"
        assert response.content.startswith(b"%PDF-")

    def test_another_customer_gets_not_found(self, other_api: APIClient, paid_order: Order) -> None:
        response = other_api.get(self.URL.format(paid_order.pk))
        assert response.status_code == 404
        assert not response.content.startswith(b"%PDF")

    def test_anonymous_is_refused(self, api: APIClient, paid_order: Order) -> None:
        assert api.get(self.URL.format(paid_order.pk)).status_code == 401

    def test_admin_downloads_any_invoice(self, admin_api: APIClient, paid_order: Order) -> None:
        response = admin_api.get(f"/api/admin/orders/{paid_order.pk}/invoice/")
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF-")

    def test_customer_cannot_use_the_admin_route(
        self, customer_api: APIClient, paid_order: Order
    ) -> None:
        response = customer_api.get(f"/api/admin/orders/{paid_order.pk}/invoice/")
        assert response.status_code == 403

    def test_unpaid_order_is_a_conflict(self, customer_api: APIClient, paid_order: Order) -> None:
        Order.objects.filter(pk=paid_order.pk).update(
            paid_at=None, status=OrderStatus.PAYMENT_FAILED
        )
        response = customer_api.get(self.URL.format(paid_order.pk))
        assert response.status_code == 409

    @pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
    def test_read_only(self, customer_api: APIClient, paid_order: Order, method: str) -> None:
        response = getattr(customer_api, method)(self.URL.format(paid_order.pk))
        assert response.status_code == 405

    def test_unknown_order(self, customer_api: APIClient, paid_order: Any) -> None:
        url = self.URL.format("00000000-0000-0000-0000-000000000000")
        assert customer_api.get(url).status_code == 404
