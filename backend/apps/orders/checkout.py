"""Checkout: reserve stock, create the order, charge, then finalise.

Overselling is prevented by locking every product row in the cart (``SELECT ... FOR
UPDATE``, in primary-key order to avoid deadlocks) before checking and decrementing stock in
the same transaction. A concurrent checkout for the same product blocks until the first one
commits and then sees the reduced stock. The ``stock >= 0`` database constraint is a final
backstop.

The payment call happens *after* the reservation transaction commits, so row locks are never
held across a network call. If the charge is declined the order moves to ``payment_failed``
and the reserved stock is released.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F

from apps.accounts.models import User
from apps.cart.models import CartItem
from apps.catalog.models import Product
from apps.orders import state
from apps.orders.models import Order, OrderEvent, OrderItem, OrderStatus
from apps.orders.pricing import compute_totals, money
from apps.payments.registry import get_payment_provider


@dataclass(frozen=True)
class ShippingAddress:
    name: str
    line1: str
    city: str
    postal_code: str
    country: str
    line2: str = ""


class CheckoutError(Exception):
    code = "checkout_error"

    def __init__(self, message: str, details: list[dict[str, Any]] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or []


class EmptyCart(CheckoutError):
    code = "empty_cart"


class InsufficientStock(CheckoutError):
    code = "insufficient_stock"


class PaymentDeclined(CheckoutError):
    code = "payment_declined"

    def __init__(self, message: str, order: Order) -> None:
        super().__init__(message)
        self.order = order


@dataclass(frozen=True)
class CheckoutResult:
    order: Order
    replayed: bool


def place_order(
    user: User,
    *,
    address: ShippingAddress,
    payment_token: str,
    idempotency_key: str,
) -> CheckoutResult:
    existing = Order.objects.filter(user=user, idempotency_key=idempotency_key).first()
    if existing is not None:
        return CheckoutResult(existing, replayed=True)

    try:
        order = _reserve(user, address, idempotency_key)
    except IntegrityError:
        # A concurrent request with the same idempotency key won the race.
        winner = Order.objects.filter(user=user, idempotency_key=idempotency_key).first()
        if winner is None:
            raise
        return CheckoutResult(winner, replayed=True)

    provider = get_payment_provider()
    result = provider.charge(
        amount=order.total,
        currency=order.currency,
        payment_token=payment_token,
        idempotency_key=str(order.id),
    )
    if not result.success:
        order = state.transition(
            order,
            OrderStatus.PAYMENT_FAILED,
            note=result.failure_reason,
            failure_reason=result.failure_reason[:200],
            payment_reference=result.reference,
        )
        raise PaymentDeclined(result.failure_reason or "Payment was declined.", order)

    try:
        with transaction.atomic():
            order = state.transition(
                order,
                OrderStatus.PAID,
                note="Payment captured",
                payment_reference=result.reference,
            )
            _consume_cart(user, order)
    except state.InvalidTransition:
        # The order was cancelled (e.g. by an admin) while the charge was in flight: the
        # stock is already released, so give the money back and report the final state.
        provider.refund(reference=result.reference, amount=order.total, currency=order.currency)
        order.refresh_from_db()
        raise CheckoutError("The order was cancelled before payment completed.") from None
    return CheckoutResult(order, replayed=False)


@transaction.atomic
def _reserve(user: User, address: ShippingAddress, idempotency_key: str) -> Order:
    cart_items = list(
        CartItem.objects.filter(cart__user=user).select_related("product").order_by("product_id")
    )
    if not cart_items:
        raise EmptyCart("Your cart is empty.")

    product_ids = [item.product_id for item in cart_items]
    locked = {
        p.pk: p
        for p in Product.objects.select_for_update().filter(pk__in=product_ids).order_by("pk")
    }

    problems: list[dict[str, Any]] = []
    for item in cart_items:
        product = locked[item.product_id]
        if not product.is_active or product.stock < item.quantity:
            problems.append(
                {
                    "product_id": product.pk,
                    "name": product.name,
                    "requested": item.quantity,
                    "available": product.stock if product.is_active else 0,
                }
            )
    if problems:
        raise InsufficientStock("Some items are no longer available in that quantity.", problems)

    subtotal = sum((locked[i.product_id].price * i.quantity for i in cart_items), Decimal("0"))
    totals = compute_totals(subtotal)
    order = Order.objects.create(
        user=user,
        status=OrderStatus.PENDING_PAYMENT,
        currency=settings.STORE_CURRENCY,
        subtotal=totals.subtotal,
        shipping=totals.shipping,
        tax=totals.tax,
        total=totals.total,
        shipping_name=address.name,
        shipping_line1=address.line1,
        shipping_line2=address.line2,
        shipping_city=address.city,
        shipping_postal_code=address.postal_code,
        shipping_country=address.country,
        payment_provider=get_payment_provider().name,
        idempotency_key=idempotency_key,
    )
    OrderItem.objects.bulk_create(
        [
            OrderItem(
                order=order,
                product=locked[i.product_id],
                product_name=locked[i.product_id].name,
                sku=locked[i.product_id].sku,
                image_url=locked[i.product_id].image_url,
                unit_price=locked[i.product_id].price,
                quantity=i.quantity,
                line_total=money(locked[i.product_id].price * i.quantity),
            )
            for i in cart_items
        ]
    )
    for item in cart_items:
        Product.objects.filter(pk=item.product_id).update(stock=F("stock") - item.quantity)
    OrderEvent.objects.create(
        order=order, to_status=OrderStatus.PENDING_PAYMENT, note="Order placed; stock reserved"
    )
    return order


def _consume_cart(user: User, order: Order) -> None:
    """Remove purchased quantities from the cart (items added meanwhile are kept)."""
    purchased = {item.product_id: item.quantity for item in order.items.all()}
    for cart_item in CartItem.objects.select_for_update().filter(
        cart__user=user, product_id__in=purchased
    ):
        remaining = cart_item.quantity - purchased[cart_item.product_id]
        if remaining > 0:
            cart_item.quantity = remaining
            cart_item.save(update_fields=["quantity"])
        else:
            cart_item.delete()
