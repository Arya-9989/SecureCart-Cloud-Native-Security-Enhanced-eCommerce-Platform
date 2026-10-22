"""Payment provider contract.

Checkout talks to payments only through this interface, so swapping the mock for a real
gateway (Stripe, Razorpay, ...) means adding one class and changing ``PAYMENT_PROVIDER``.
Card data never reaches SecureCart: the client sends an opaque ``payment_token`` produced
by the provider's own SDK (or, for the mock, one of its documented test tokens).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class ChargeResult:
    success: bool
    reference: str
    failure_reason: str = ""


@dataclass(frozen=True)
class RefundResult:
    success: bool
    reference: str


class PaymentProvider(ABC):
    name: str = "base"

    @abstractmethod
    def charge(
        self, *, amount: Decimal, currency: str, payment_token: str, idempotency_key: str
    ) -> ChargeResult:
        """Capture ``amount``. Must be idempotent for the same ``idempotency_key``."""

    @abstractmethod
    def refund(self, *, reference: str, amount: Decimal, currency: str) -> RefundResult:
        """Refund a previously captured charge."""
