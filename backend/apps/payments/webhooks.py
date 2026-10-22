"""Stripe webhooks: verify, de-duplicate, then drive the order state machine.

Security properties, in the order they are checked:

1. **Authenticity.** The ``Stripe-Signature`` header must carry an HMAC-SHA256 of
   ``"{timestamp}.{raw body}"`` under the endpoint secret (verified by the official
   library, constant-time, accepting any of several ``v1`` signatures during a secret
   rotation).
2. **Freshness.** The signed timestamp must be within ``STRIPE_WEBHOOK_TOLERANCE_SECONDS``,
   so a captured delivery cannot be replayed later.
3. **Uniqueness.** The event id is stored in the same transaction as its effect, so a
   replay inside the tolerance window, or Stripe's own redelivery, changes nothing.
   Concurrent duplicates serialise on the unique index.
4. **Mode.** A live-mode event is rejected by a test-mode store and the other way round.
5. **Binding.** The PaymentIntent must name one of our orders in its metadata, match the
   reference we stored, and (for a success) carry exactly the order's amount and currency.

Effects are idempotent state-machine moves. Success marks the order paid. A success for an
order that is no longer payable (cancelled or expired meanwhile) is refunded. Failure
releases the stock, and cancellation cancels the order.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

import stripe
from django.conf import settings
from django.db import IntegrityError, transaction

from apps.audit import services as audit
from apps.orders import checkout, state
from apps.orders.models import Order, OrderStatus
from apps.payments.models import WebhookEvent
from apps.payments.money import to_minor_units

logger = logging.getLogger("securecart.payments")


class InvalidWebhook(Exception):
    """Bad or missing signature, stale timestamp, unparseable body or wrong mode."""


def verify(payload: bytes, signature: str | None) -> dict[str, Any]:
    """Return the verified event as a plain dict, or raise ``InvalidWebhook``."""
    secret = settings.STRIPE_WEBHOOK_SECRET
    if not secret or not signature:
        raise InvalidWebhook("missing signature")
    try:
        event = stripe.Webhook.construct_event(
            payload, signature, secret, tolerance=settings.STRIPE_WEBHOOK_TOLERANCE_SECONDS
        )
    except stripe.SignatureVerificationError as exc:
        raise InvalidWebhook("signature or timestamp rejected") from exc
    except ValueError as exc:
        raise InvalidWebhook("body is not a Stripe event") from exc
    data: dict[str, Any] = event.to_dict()
    store_is_live = settings.STRIPE_SECRET_KEY.startswith(("sk_live_", "rk_live_"))
    if bool(data.get("livemode", False)) != store_is_live:
        raise InvalidWebhook("event mode does not match the configured key")
    if not isinstance(data.get("data", {}).get("object"), dict):
        raise InvalidWebhook("event carries no object")
    return data


def handle(event: dict[str, Any]) -> str:
    """Apply a verified event exactly once. Returns a short outcome label."""
    with transaction.atomic():
        try:
            with transaction.atomic():
                record = WebhookEvent.objects.create(
                    provider="stripe", event_id=str(event["id"]), event_type=str(event["type"])
                )
        except IntegrityError:
            return "duplicate"
        handler = _HANDLERS.get(str(event["type"]))
        outcome = handler(event["data"]["object"]) if handler else "ignored"
        record.outcome = outcome
        record.save(update_fields=["outcome"])
    logger.info("stripe webhook id=%s type=%s outcome=%s", event["id"], event["type"], outcome)
    return outcome


def _order_for(intent: dict[str, Any]) -> Order | None:
    raw_id = (intent.get("metadata") or {}).get("order_id")
    try:
        order_id = uuid.UUID(str(raw_id))
    except ValueError:
        return None
    order = Order.objects.filter(pk=order_id, payment_provider="stripe").first()
    if order is None:
        return None
    intent_id = str(intent.get("id", ""))
    if order.payment_reference and order.payment_reference != intent_id:
        logger.warning("stripe intent %s does not match order %s", intent_id, order.number)
        return None
    if not order.payment_reference:
        # The webhook can beat the checkout request that stores the reference.
        Order.objects.filter(pk=order.pk, payment_reference="").update(payment_reference=intent_id)
        order.payment_reference = intent_id
    return order


def _on_succeeded(intent: dict[str, Any]) -> str:
    order = _order_for(intent)
    if order is None:
        return "unknown_order"
    received = int(intent.get("amount_received") or 0)
    currency = str(intent.get("currency", "")).upper()
    if received != to_minor_units(order.total, order.currency) or currency != order.currency:
        audit.record(
            "payment.amount_mismatch",
            target=order,
            changes={
                "expected": str(order.total),
                "received_minor": received,
                "currency": currency,
            },
        )
        return "amount_mismatch"
    if order.status == OrderStatus.PENDING_PAYMENT:
        try:
            checkout.finalize_paid(order, intent["id"], note="Payment confirmed by Stripe")
        except state.InvalidTransition:
            order.refresh_from_db()
        else:
            return "paid"
    if order.status in {OrderStatus.CANCELLED, OrderStatus.PAYMENT_FAILED}:
        if not checkout.refund_late_payment(order, intent["id"]):
            # Raising rolls the event id back, so Stripe's retry gets another attempt.
            raise state.RefundFailed(f"Refund of late payment failed for {order.number}.")
        audit.record(
            "payment.late_payment_refunded", target=order, changes={"intent": intent["id"]}
        )
        return "refunded_late_payment"
    return "already_settled"


def _on_failed(intent: dict[str, Any]) -> str:
    order = _order_for(intent)
    if order is None:
        return "unknown_order"
    if order.status != OrderStatus.PENDING_PAYMENT:
        return "already_settled"
    error = intent.get("last_payment_error") or {}
    reason = str(error.get("message") or "The payment did not go through.")
    checkout.mark_failed(order, reason, intent["id"])
    return "payment_failed"


def _on_canceled(intent: dict[str, Any]) -> str:
    order = _order_for(intent)
    if order is None:
        return "unknown_order"
    if order.status != OrderStatus.PENDING_PAYMENT:
        return "already_settled"  # never let this event cancel (and refund) a paid order
    try:
        state.transition(order, OrderStatus.CANCELLED, note="Payment cancelled at Stripe")
    except state.InvalidTransition:
        return "already_settled"
    return "cancelled"


_HANDLERS = {
    "payment_intent.succeeded": _on_succeeded,
    "payment_intent.payment_failed": _on_failed,
    "payment_intent.canceled": _on_canceled,
}
