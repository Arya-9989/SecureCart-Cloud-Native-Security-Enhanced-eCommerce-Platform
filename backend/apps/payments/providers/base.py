"""Payment provider contract.

Checkout talks to payments only through this interface, so swapping the mock for a real
gateway means adding one class and changing ``PAYMENT_PROVIDER``. Card data never reaches
SecureCart: the client sends an opaque ``payment_token`` produced by the provider's own SDK
(or, for the mock and Stripe test mode, one of the provider's documented test tokens).

Two confirmation models are supported:

- **Synchronous** (the mock): ``charge`` returns the final answer and checkout marks the order
  ``paid`` or ``payment_failed`` straight away.
- **Asynchronous** (Stripe, ``confirms_asynchronously = True``): ``charge`` starts the payment.
  The order stays ``pending_payment`` until a signed webhook (or reconciliation by
  ``expire_pending_orders``) reports the outcome. A charge that may or may not have gone
  through (a timeout, say) is reported as ``pending``, never as a failure, so stock is not
  released for money that might have been taken.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any


@dataclass(frozen=True)
class ChargeResult:
    success: bool
    reference: str
    failure_reason: str = ""
    #: The outcome is not known yet (processing, needs customer action, or a network failure
    #: after the request may have reached the provider). Never treat this as a decline.
    pending: bool = False


@dataclass(frozen=True)
class RefundResult:
    success: bool
    reference: str


@dataclass(frozen=True)
class TestMethod:
    token: str
    label: str
    description: str


@dataclass(frozen=True)
class PublicConfig:
    """What the storefront needs to render the payment step. Holds no secrets."""

    provider: str
    mode: str  # "offline" (mock), "test" or "live"
    test_methods: list[TestMethod] = field(default_factory=list)


class PaymentProvider(ABC):
    name: str = "base"
    #: True when the final outcome arrives later (webhooks), not in ``charge``'s answer.
    confirms_asynchronously: bool = False

    @abstractmethod
    def charge(
        self, *, amount: Decimal, currency: str, payment_token: str, idempotency_key: str
    ) -> ChargeResult:
        """Capture ``amount``. Must be idempotent for the same ``idempotency_key``."""

    @abstractmethod
    def refund(
        self, *, reference: str, amount: Decimal, currency: str, idempotency_key: str = ""
    ) -> RefundResult:
        """Refund a previously captured charge (idempotent for the same key, if given)."""

    def retrieve(self, reference: str) -> ChargeResult:
        """Ask the provider for the current state of a payment (used by reconciliation)."""
        raise NotImplementedError(f"{self.name} cannot look payments up.")

    def cancel(self, reference: str) -> None:  # noqa: B027 - optional hook
        """Abandon a payment that has not completed. Default: nothing to cancel."""

    @abstractmethod
    def public_config(self) -> PublicConfig:
        """Provider name, mode and test payment methods for the checkout page."""

    def describe(self) -> dict[str, Any]:
        config = self.public_config()
        return {
            "provider": config.provider,
            "mode": config.mode,
            "confirms_asynchronously": self.confirms_asynchronously,
            "test_methods": [
                {"token": m.token, "label": m.label, "description": m.description}
                for m in config.test_methods
            ],
        }
