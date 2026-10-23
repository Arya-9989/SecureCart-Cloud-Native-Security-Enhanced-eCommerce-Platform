"""Stripe webhook fixtures, signed exactly as Stripe signs them.

Stripe's scheme (https://docs.stripe.com/webhooks#verify-manually): the ``Stripe-Signature``
header is ``t=<unix seconds>,v1=<hex HMAC-SHA256(secret, f"{t}.{raw body}")>``, and may
carry several ``v1`` entries while a secret is being rolled. This module implements that
independently of the stripe library, so the tests check the server against the spec rather
than against itself.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from typing import Any

WEBHOOK_SECRET = "whsec_test_fixture_secret_0123456789"


def payment_intent(
    order_id: str,
    *,
    intent_id: str = "pi_test_123",
    amount: int = 5399,
    currency: str = "usd",
    status: str = "succeeded",
    failure: str | None = None,
) -> dict[str, Any]:
    return {
        "id": intent_id,
        "object": "payment_intent",
        "amount": amount,
        "amount_received": amount if status == "succeeded" else 0,
        "currency": currency,
        "status": status,
        "livemode": False,
        "metadata": {"order_id": order_id},
        "last_payment_error": {"message": failure, "type": "card_error"} if failure else None,
    }


def event(
    event_type: str,
    obj: dict[str, Any],
    *,
    event_id: str | None = None,
    livemode: bool = False,
) -> bytes:
    body = {
        "id": event_id or f"evt_{uuid.uuid4().hex[:24]}",
        "object": "event",
        "api_version": "2026-09-30.basil",
        "created": int(time.time()),
        "livemode": livemode,
        "type": event_type,
        "pending_webhooks": 1,
        "request": {"id": None, "idempotency_key": None},
        "data": {"object": obj},
    }
    return json.dumps(body, separators=(",", ":")).encode()


def sign(
    payload: bytes,
    secret: str = WEBHOOK_SECRET,
    *,
    timestamp: int | None = None,
    extra_v1: list[str] | None = None,
) -> str:
    t = int(time.time()) if timestamp is None else timestamp
    signed = f"{t}.".encode() + payload
    digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    parts = [f"t={t}", *(f"v1={sig}" for sig in (extra_v1 or [])), f"v1={digest}"]
    return ",".join(parts)
