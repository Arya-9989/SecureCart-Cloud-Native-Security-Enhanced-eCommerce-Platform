"""The jobs ``run_scheduler`` runs, and how often."""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from apps.accounts.models import OneTimeToken
from apps.core.scheduler import Job
from apps.orders.management.commands.expire_pending_orders import expire_pending_orders
from apps.payments.models import WebhookEvent


def settle_pending_orders() -> dict[str, int]:
    return expire_pending_orders(settings.PENDING_ORDER_TIMEOUT_MINUTES)


def purge_expired_records() -> dict[str, int]:
    """Drop rows whose only purpose has passed (they hold no history worth keeping)."""
    now = timezone.now()
    day_ago = now - timedelta(days=1)
    tokens, _ = OneTimeToken.objects.filter(
        Q(expires_at__lt=day_ago) | Q(used_at__lt=day_ago)
    ).delete()
    # Signed webhooks older than the 5-minute tolerance are rejected anyway; ids are kept
    # for 30 days so redeliveries (Stripe retries for up to 3 days) stay no-ops.
    events, _ = WebhookEvent.objects.filter(received_at__lt=now - timedelta(days=30)).delete()
    # Expired refresh tokens (and their blacklist rows) can never be presented again.
    sessions, _ = OutstandingToken.objects.filter(expires_at__lt=now).delete()
    return {"one_time_tokens": tokens, "webhook_events": events, "refresh_tokens": sessions}


def default_jobs() -> list[Job]:
    return [
        Job(
            "settle_pending_orders",
            every=timedelta(seconds=settings.SCHEDULER_PENDING_ORDERS_EVERY_SECONDS),
            run=settle_pending_orders,
        ),
        Job("purge_expired_records", every=timedelta(hours=1), run=purge_expired_records),
    ]
