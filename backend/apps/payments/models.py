from __future__ import annotations

from django.db import models


class WebhookEvent(models.Model):
    """Every provider event id we have acted on, so a replayed or redelivered event is a no-op.

    The row is written in the same transaction as the event's effect: if handling fails, the
    id is rolled back with it and the provider's retry is processed normally.
    """

    provider = models.CharField(max_length=32)
    event_id = models.CharField(max_length=255)
    event_type = models.CharField(max_length=100)
    outcome = models.CharField(max_length=64, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "event_id"], name="webhook_event_unique_per_provider"
            )
        ]
        indexes = [models.Index(fields=["received_at"])]

    def __str__(self) -> str:
        return f"{self.provider}:{self.event_id} ({self.event_type})"
