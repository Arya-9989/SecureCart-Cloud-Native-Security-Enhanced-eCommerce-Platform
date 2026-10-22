from __future__ import annotations

from datetime import timedelta
from io import StringIO
from itertools import product as cartesian
from unittest import mock

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.catalog.models import Product
from apps.orders import state
from apps.orders.checkout import ShippingAddress, _reserve
from apps.orders.models import Order, OrderStatus
from apps.payments.providers.base import RefundResult
from apps.payments.providers.mock import MockPaymentProvider
from tests.conftest import add_to_cart, checkout

S = OrderStatus
pytestmark = pytest.mark.django_db

VALID = {
    (S.PENDING_PAYMENT, S.PAID),
    (S.PENDING_PAYMENT, S.PAYMENT_FAILED),
    (S.PENDING_PAYMENT, S.CANCELLED),
    (S.PAID, S.SHIPPED),
    (S.PAID, S.CANCELLED),
    (S.SHIPPED, S.DELIVERED),
}


@pytest.mark.parametrize(("current", "target"), list(cartesian(S.values, S.values)))
def test_state_machine_allows_exactly_the_documented_transitions(current, target) -> None:
    assert state.can_transition(current, target) is ((current, target) in VALID)


@pytest.fixture
def paid_order(customer_api: APIClient, customer: User, product: Product) -> Order:
    add_to_cart(customer, product, 2)
    response = checkout(customer_api)
    assert response.status_code == 201
    return Order.objects.get(pk=response.data["id"])


class TestCustomerCancellation:
    def test_cancelling_paid_order_refunds_and_restocks(
        self, customer_api: APIClient, paid_order: Order, product: Product
    ) -> None:
        product.refresh_from_db()
        assert product.stock == 8
        with mock.patch.object(
            MockPaymentProvider, "refund", wraps=MockPaymentProvider().refund
        ) as refund:
            response = customer_api.post(f"/api/orders/{paid_order.id}/cancel/")
        assert response.status_code == 200
        assert response.data["status"] == "cancelled"
        assert response.data["can_cancel"] is False
        refund.assert_called_once()
        product.refresh_from_db()
        assert product.stock == 10

    def test_cannot_cancel_shipped_order(
        self, customer_api: APIClient, paid_order: Order, admin: User
    ) -> None:
        state.transition(paid_order, S.SHIPPED, actor=admin)
        response = customer_api.post(f"/api/orders/{paid_order.id}/cancel/")
        assert response.status_code == 409
        assert Order.objects.get(pk=paid_order.pk).status == S.SHIPPED

    def test_double_cancel_does_not_restock_twice(
        self, customer_api: APIClient, paid_order: Order, product: Product
    ) -> None:
        assert customer_api.post(f"/api/orders/{paid_order.id}/cancel/").status_code == 200
        assert customer_api.post(f"/api/orders/{paid_order.id}/cancel/").status_code == 409
        product.refresh_from_db()
        assert product.stock == 10

    def test_failed_refund_rolls_back_cancellation(
        self, customer_api: APIClient, paid_order: Order, product: Product
    ) -> None:
        with (
            mock.patch.object(MockPaymentProvider, "refund", return_value=RefundResult(False, "")),
            pytest.raises(state.RefundFailed),
        ):
            state.transition(paid_order, S.CANCELLED)
        product.refresh_from_db()
        assert product.stock == 8
        assert Order.objects.get(pk=paid_order.pk).status == S.PAID


class TestAdminFulfilment:
    def test_ship_then_deliver_with_timeline_and_audit(
        self, admin_api: APIClient, paid_order: Order
    ) -> None:
        url = f"/api/admin/orders/{paid_order.id}/transition/"
        shipped = admin_api.post(url, {"status": "shipped", "note": "UPS 1Z999"})
        assert shipped.status_code == 200
        assert shipped.data["allowed_transitions"] == ["delivered"]
        delivered = admin_api.post(url, {"status": "delivered"})
        assert delivered.data["status"] == "delivered"
        assert delivered.data["delivered_at"] is not None
        assert [e["to_status"] for e in delivered.data["events"]] == [
            "pending_payment",
            "paid",
            "shipped",
            "delivered",
        ]
        assert AuditLog.objects.filter(action="admin.order.status_changed").count() == 2

    def test_invalid_transition_is_conflict(self, admin_api: APIClient, paid_order) -> None:
        url = f"/api/admin/orders/{paid_order.id}/transition/"
        assert admin_api.post(url, {"status": "delivered"}).status_code == 409

    def test_admin_cannot_force_system_only_statuses(self, admin_api, paid_order) -> None:
        url = f"/api/admin/orders/{paid_order.id}/transition/"
        for target in ("paid", "payment_failed", "pending_payment"):
            assert admin_api.post(url, {"status": target}).status_code == 400

    def test_filter_and_search(self, admin_api: APIClient, paid_order: Order) -> None:
        assert admin_api.get("/api/admin/orders/?status=paid").data["count"] == 1
        assert admin_api.get("/api/admin/orders/?status=shipped").data["count"] == 0
        assert admin_api.get(f"/api/admin/orders/?search={paid_order.number}").data["count"] == 1
        assert admin_api.get("/api/admin/orders/?search=customer@").data["count"] == 1


class TestCancelledDuringPayment:
    def test_order_cancelled_mid_charge_is_refunded(
        self, customer_api: APIClient, customer: User, product: Product
    ) -> None:
        add_to_cart(customer, product, 1)
        original_charge = MockPaymentProvider.charge

        def charge_then_cancel(self, **kwargs):
            order = Order.objects.get(user=customer)
            state.transition(order, S.CANCELLED, note="admin cancelled")
            return original_charge(self, **kwargs)

        with (
            mock.patch.object(MockPaymentProvider, "charge", charge_then_cancel),
            mock.patch.object(
                MockPaymentProvider, "refund", wraps=MockPaymentProvider().refund
            ) as refund,
        ):
            response = checkout(customer_api)
        assert response.status_code == 409
        refund.assert_called_once()
        product.refresh_from_db()
        assert product.stock == 10


class TestExpirePendingOrders:
    def test_releases_stale_reservations_only(self, customer: User, product: Product) -> None:
        add_to_cart(customer, product, 4)
        address = ShippingAddress("A", "1 Road", "City", "12345", "US")
        stale = _reserve(customer, address, "stale-key-1")
        fresh = _reserve(customer, address, "fresh-key-1")
        Order.objects.filter(pk=stale.pk).update(created_at=timezone.now() - timedelta(hours=2))
        product.refresh_from_db()
        assert product.stock == 2

        out = StringIO()
        call_command("expire_pending_orders", "--minutes=30", stdout=out)

        assert "Expired 1" in out.getvalue()
        assert Order.objects.get(pk=stale.pk).status == S.CANCELLED
        assert Order.objects.get(pk=fresh.pk).status == S.PENDING_PAYMENT
        product.refresh_from_db()
        assert product.stock == 6
