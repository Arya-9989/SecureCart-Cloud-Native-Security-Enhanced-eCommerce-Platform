"""Stripe, through PaymentIntents, in test mode by default.

- ``charge`` creates and confirms a PaymentIntent server-side for a PaymentMethod id. In
  test mode the checkout offers Stripe's documented test methods (``pm_card_visa``,
  ``pm_card_chargeDeclined``), so no card data exists anywhere. Collecting a real card needs
  Stripe Elements in the browser, which is out of scope for this demo store (see ADR 0003).
- The PaymentIntent carries ``metadata.order_id`` and is created with the order id as the
  idempotency key, so a retried request returns the same PaymentIntent and never charges
  twice.
- The order's final state comes from signed webhooks (``apps.payments.webhooks``), so
  ``confirms_asynchronously`` is True. A network failure after the request may have reached
  Stripe is reported as *pending*, not failed: the webhook or reconciliation settles it.
- Live keys (``sk_live_``) are refused unless ``STRIPE_ALLOW_LIVE_MODE=true``.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

import stripe
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from apps.payments.money import to_minor_units
from apps.payments.providers.base import (
    ChargeResult,
    PaymentProvider,
    PublicConfig,
    RefundResult,
    TestMethod,
)

logger = logging.getLogger("securecart.payments")

#: Stripe's documented test-mode PaymentMethods (https://docs.stripe.com/testing).
TEST_METHODS = [
    TestMethod("pm_card_visa", "Test card: Visa", "Stripe test mode approves this card."),
    TestMethod(
        "pm_card_chargeDeclined",
        "Test card: declined",
        "Stripe test mode declines this card, so you can see stock being released.",
    ),
]

_PENDING_STATUSES = {"processing", "requires_action", "requires_capture", "requires_confirmation"}


def _result_from_intent(intent: Any) -> ChargeResult:
    status = getattr(intent, "status", "")
    reference = str(getattr(intent, "id", ""))
    if status == "succeeded":
        return ChargeResult(True, reference)
    if status in _PENDING_STATUSES:
        return ChargeResult(False, reference, "Waiting for the payment to complete.", pending=True)
    error = getattr(intent, "last_payment_error", None)
    reason = getattr(error, "message", None) or "The payment did not go through."
    return ChargeResult(False, reference, str(reason)[:200])


class StripePaymentProvider(PaymentProvider):
    name = "stripe"
    confirms_asynchronously = True

    def __init__(self) -> None:
        key = settings.STRIPE_SECRET_KEY
        if not key:
            raise ImproperlyConfigured("PAYMENT_PROVIDER is Stripe but STRIPE_SECRET_KEY is empty.")
        if not settings.STRIPE_WEBHOOK_SECRET:
            raise ImproperlyConfigured(
                "Stripe confirms payments by webhook: set STRIPE_WEBHOOK_SECRET as well."
            )
        self.live = key.startswith(("sk_live_", "rk_live_"))
        if self.live and not settings.STRIPE_ALLOW_LIVE_MODE:
            raise ImproperlyConfigured(
                "Refusing a live Stripe key. This store runs in test mode; set "
                "STRIPE_ALLOW_LIVE_MODE=true only for a real deployment with Stripe Elements."
            )
        self.client = stripe.StripeClient(
            key,
            base_addresses={"api": settings.STRIPE_API_BASE},
            http_client=stripe.RequestsClient(timeout=settings.STRIPE_TIMEOUT_SECONDS),
            max_network_retries=settings.STRIPE_MAX_NETWORK_RETRIES,
        )

    def charge(
        self, *, amount: Decimal, currency: str, payment_token: str, idempotency_key: str
    ) -> ChargeResult:
        params: dict[str, Any] = {
            "amount": to_minor_units(amount, currency),
            "currency": currency.lower(),
            "payment_method": payment_token,
            "confirm": True,
            # Cards only, no redirects: the store has no return URL flow.
            "automatic_payment_methods": {"enabled": True, "allow_redirects": "never"},
            "metadata": {"order_id": idempotency_key},
            "description": f"SecureCart order {idempotency_key}",
        }
        try:
            intent = self.client.v1.payment_intents.create(
                params=params,  # type: ignore[arg-type]
                options={"idempotency_key": f"charge-{idempotency_key}"},
            )
        except stripe.CardError as exc:
            # A decline: Stripe answered, nothing was captured.
            intent_id = getattr(getattr(exc, "error", None), "payment_intent", None)
            reference = str(getattr(intent_id, "id", "") or "")
            reason = exc.user_message or "Your card was declined."
            return ChargeResult(False, reference, str(reason)[:200])
        except (stripe.APIConnectionError, stripe.APIError) as exc:
            # The request may have reached Stripe. Unknown is not "declined": keep the stock
            # reserved and let the webhook or reconciliation decide.
            logger.warning("stripe charge outcome unknown order=%s error=%s", idempotency_key, exc)
            return ChargeResult(False, "", "Payment confirmation is delayed.", pending=True)
        except stripe.StripeError as exc:
            # Rejected before any money moved (bad request, auth, rate limit, ...).
            logger.error("stripe charge rejected order=%s error=%s", idempotency_key, exc)
            return ChargeResult(False, "", "The payment could not be started.")
        return _result_from_intent(intent)

    def refund(
        self, *, reference: str, amount: Decimal, currency: str, idempotency_key: str = ""
    ) -> RefundResult:
        options: dict[str, Any] = {}
        if idempotency_key:
            options["idempotency_key"] = f"refund-{idempotency_key}"
        try:
            refund = self.client.v1.refunds.create(
                params={"payment_intent": reference, "amount": to_minor_units(amount, currency)},
                options=options,  # type: ignore[arg-type]
            )
        except stripe.StripeError as exc:
            logger.error("stripe refund failed intent=%s error=%s", reference, exc)
            return RefundResult(False, "")
        return RefundResult(refund.status in {"succeeded", "pending"}, str(refund.id))

    def retrieve(self, reference: str) -> ChargeResult:
        try:
            intent = self.client.v1.payment_intents.retrieve(reference)
        except stripe.StripeError as exc:
            logger.warning("stripe retrieve failed intent=%s error=%s", reference, exc)
            return ChargeResult(False, reference, "Lookup failed.", pending=True)
        return _result_from_intent(intent)

    def cancel(self, reference: str) -> None:
        try:
            self.client.v1.payment_intents.cancel(reference)
        except stripe.StripeError as exc:
            # Already succeeded or cancelled: the webhook carries the truth either way.
            logger.info("stripe cancel skipped intent=%s error=%s", reference, exc)

    def public_config(self) -> PublicConfig:
        return PublicConfig(
            provider=self.name,
            mode="live" if self.live else "test",
            test_methods=[] if self.live else TEST_METHODS,
        )
