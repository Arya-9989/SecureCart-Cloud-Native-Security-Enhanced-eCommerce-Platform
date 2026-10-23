"""Settle orders stuck in ``pending_payment`` and release the stock they hold.

Checkout reserves stock before calling the payment provider. If the process dies between
those steps, or an asynchronous provider's webhook never arrives, the reservation would
leak. For each order older than ``--minutes``:

- With a provider that confirms asynchronously (Stripe) and a stored payment reference, ask
  the provider first. A payment that succeeded is marked paid (the webhook was lost), one
  that is still processing is left alone, and anything else is cancelled at the provider and
  then here.
- Otherwise the order is cancelled and its stock released.

A payment that succeeds after its order was cancelled is refunded by the webhook handler.
Safe to run by hand or from any number of schedulers at once: every move goes through the
state machine's row lock.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.orders import checkout, state
from apps.orders.models import Order, OrderStatus
from apps.payments.registry import get_payment_provider


def expire_pending_orders(minutes: int) -> dict[str, int]:
    cutoff = timezone.now() - timedelta(minutes=minutes)
    provider = get_payment_provider()
    counts = {"expired": 0, "reconciled_paid": 0, "still_processing": 0}
    stale = Order.objects.filter(status=OrderStatus.PENDING_PAYMENT, created_at__lt=cutoff)
    for order in stale:
        reference = order.payment_reference
        asks_provider = provider.confirms_asynchronously and order.payment_provider == provider.name
        if asks_provider and reference:
            outcome = provider.retrieve(reference)
            if outcome.success:
                try:
                    checkout.finalize_paid(order, reference, note="Payment confirmed (reconciled)")
                except state.InvalidTransition:
                    continue  # settled concurrently
                counts["reconciled_paid"] += 1
                continue
            if outcome.pending:
                counts["still_processing"] += 1
                continue
            provider.cancel(reference)
        try:
            state.transition(order, OrderStatus.CANCELLED, note="Payment timed out")
        except state.InvalidTransition:
            continue  # resolved concurrently
        counts["expired"] += 1
    return counts


class Command(BaseCommand):
    help = "Settle pending_payment orders older than --minutes; release stock of abandoned ones."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--minutes", type=int, default=30)

    def handle(self, *args: Any, **options: Any) -> None:
        counts = expire_pending_orders(options["minutes"])
        self.stdout.write(
            f"Expired {counts['expired']} pending order(s); "
            f"reconciled {counts['reconciled_paid']} as paid; "
            f"{counts['still_processing']} still processing."
        )
