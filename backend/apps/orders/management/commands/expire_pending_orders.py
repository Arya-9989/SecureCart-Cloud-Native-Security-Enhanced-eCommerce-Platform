"""Release stock held by orders stuck in ``pending_payment``.

Checkout reserves stock before calling the payment provider. If the process dies between
those steps the reservation would leak, so run this periodically (e.g. a cron job or a
Kubernetes CronJob every few minutes).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.orders import state
from apps.orders.models import Order, OrderStatus


class Command(BaseCommand):
    help = "Cancel pending_payment orders older than --minutes and release their stock."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--minutes", type=int, default=30)

    def handle(self, *args: Any, **options: Any) -> None:
        cutoff = timezone.now() - timedelta(minutes=options["minutes"])
        expired = 0
        for order in Order.objects.filter(
            status=OrderStatus.PENDING_PAYMENT, created_at__lt=cutoff
        ):
            try:
                state.transition(order, OrderStatus.CANCELLED, note="Payment timed out")
            except state.InvalidTransition:
                continue  # resolved concurrently
            expired += 1
        self.stdout.write(f"Expired {expired} pending order(s).")
