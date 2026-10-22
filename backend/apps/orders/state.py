"""Order lifecycle state machine.

    pending_payment ──► paid ──► shipped ──► delivered
          │               │
          │               └────► cancelled   (refund + restock)
          ├────────────────────► cancelled   (restock)
          └────────────────────► payment_failed (restock)

Every transition runs inside a transaction holding a row lock on the order, so concurrent
actors (e.g. a customer cancelling while an admin ships) cannot both succeed.
"""

from __future__ import annotations

from typing import Any

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.catalog.models import Product
from apps.orders.models import Order, OrderEvent, OrderStatus
from apps.payments.registry import get_payment_provider

S = OrderStatus

TRANSITIONS: dict[str, frozenset[str]] = {
    S.PENDING_PAYMENT: frozenset({S.PAID, S.PAYMENT_FAILED, S.CANCELLED}),
    S.PAID: frozenset({S.SHIPPED, S.CANCELLED}),
    S.SHIPPED: frozenset({S.DELIVERED}),
    S.DELIVERED: frozenset(),
    S.CANCELLED: frozenset(),
    S.PAYMENT_FAILED: frozenset(),
}

#: Statuses a customer may move their own order into.
CUSTOMER_ALLOWED: frozenset[str] = frozenset({S.CANCELLED})
#: Statuses an administrator may set manually (paid/payment_failed are set by checkout only).
ADMIN_ALLOWED: frozenset[str] = frozenset({S.SHIPPED, S.DELIVERED, S.CANCELLED})

_RELEASES_STOCK = frozenset({S.CANCELLED, S.PAYMENT_FAILED})
_TIMESTAMP_FIELD: dict[str, str] = {
    S.PAID: "paid_at",
    S.SHIPPED: "shipped_at",
    S.DELIVERED: "delivered_at",
    S.CANCELLED: "cancelled_at",
}


class InvalidTransition(Exception):
    def __init__(self, current: str, target: str) -> None:
        super().__init__(f"Cannot move an order from '{current}' to '{target}'.")
        self.current = current
        self.target = target


class RefundFailed(Exception):
    pass


def can_transition(current: str, target: str) -> bool:
    return target in TRANSITIONS.get(current, frozenset())


def transition(
    order: Order,
    target: str,
    *,
    actor: Any = None,
    note: str = "",
    **fields: Any,
) -> Order:
    """Move ``order`` to ``target`` applying side effects. Returns the refreshed order."""
    with transaction.atomic():
        locked = Order.objects.select_for_update().get(pk=order.pk)
        current = locked.status
        if not can_transition(current, target):
            raise InvalidTransition(current, target)

        # Refund first, while only this order's row is locked: the provider call must not hold
        # product rows that other shoppers' checkouts are waiting to lock. A failed refund
        # raises before any stock moves, so the whole transition rolls back.
        if target == S.CANCELLED and current == S.PAID:
            _refund(locked)
        if target in _RELEASES_STOCK:
            _release_stock(locked)

        locked.status = target
        if target in _TIMESTAMP_FIELD:
            setattr(locked, _TIMESTAMP_FIELD[target], timezone.now())
        for name, value in fields.items():
            setattr(locked, name, value)
        locked.save()
        OrderEvent.objects.create(
            order=locked, from_status=current, to_status=target, actor=actor, note=note[:255]
        )
    return locked


def _release_stock(order: Order) -> None:
    for item in order.items.all():
        Product.objects.filter(pk=item.product_id).update(stock=F("stock") + item.quantity)


def _refund(order: Order) -> None:
    provider = get_payment_provider()
    result = provider.refund(
        reference=order.payment_reference,
        amount=order.total,
        currency=order.currency,
        idempotency_key=f"cancel-{order.pk}",
    )
    if not result.success:
        raise RefundFailed(f"Refund failed for order {order.number}.")
