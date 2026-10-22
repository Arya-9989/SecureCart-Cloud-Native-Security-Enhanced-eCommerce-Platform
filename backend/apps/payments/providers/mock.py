from __future__ import annotations

import hashlib
from decimal import Decimal

from apps.payments.providers.base import ChargeResult, PaymentProvider, RefundResult

APPROVE_TOKEN = "tok_mock_approve"  # noqa: S105 - public test token, not a secret
DECLINE_TOKEN = "tok_mock_decline"  # noqa: S105


class MockPaymentProvider(PaymentProvider):
    """Deterministic, offline provider for development, demos and tests.

    It moves no money. ``tok_mock_approve`` succeeds, ``tok_mock_decline`` is declined and
    any other token is rejected as invalid. References are derived from the idempotency key
    so a retried charge returns the same reference, mirroring real gateway semantics.
    """

    name = "mock"

    def charge(
        self, *, amount: Decimal, currency: str, payment_token: str, idempotency_key: str
    ) -> ChargeResult:
        reference = "mock_ch_" + hashlib.sha256(idempotency_key.encode()).hexdigest()[:20]
        if amount <= 0:
            return ChargeResult(False, reference, "Amount must be positive.")
        if payment_token == APPROVE_TOKEN:
            return ChargeResult(True, reference)
        if payment_token == DECLINE_TOKEN:
            return ChargeResult(False, reference, "Card declined (mock).")
        return ChargeResult(False, reference, "Invalid payment token.")

    def refund(self, *, reference: str, amount: Decimal, currency: str) -> RefundResult:
        return RefundResult(True, reference.replace("mock_ch_", "mock_re_", 1))
