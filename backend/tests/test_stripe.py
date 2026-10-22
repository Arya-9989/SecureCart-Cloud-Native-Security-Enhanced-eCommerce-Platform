"""Stripe behind PaymentProvider: PaymentIntents, signed webhooks, replays, reconciliation."""

from __future__ import annotations

import os
import time
from collections.abc import Callable, Iterator
from decimal import Decimal
from io import StringIO
from typing import Any
from unittest import mock

import pytest
import stripe
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.cart.models import CartItem
from apps.catalog.models import Product
from apps.orders.models import Order, OrderEvent, OrderStatus
from apps.payments import registry
from apps.payments.models import WebhookEvent
from apps.payments.money import to_minor_units
from apps.payments.providers.base import ChargeResult, RefundResult
from apps.payments.providers.stripe_provider import StripePaymentProvider
from tests import stripe_fixtures as fx
from tests.conftest import add_to_cart, checkout

pytestmark = pytest.mark.django_db

STRIPE_MOCK_URL = os.environ.get("STRIPE_MOCK_URL", "")
STRIPE = {
    "PAYMENT_PROVIDER": "apps.payments.providers.stripe_provider.StripePaymentProvider",
    "STRIPE_SECRET_KEY": "sk_test_fixture",
    "STRIPE_WEBHOOK_SECRET": fx.WEBHOOK_SECRET,
    "STRIPE_API_BASE": STRIPE_MOCK_URL or "http://127.0.0.1:9",
    "STRIPE_MAX_NETWORK_RETRIES": 0,
    "STRIPE_TIMEOUT_SECONDS": 2,
}
WEBHOOK = "/api/payments/webhooks/stripe/"


@pytest.fixture
def stripe_store() -> Iterator[StripePaymentProvider]:
    registry._load.cache_clear()
    with override_settings(**STRIPE):
        provider = registry.get_payment_provider()
        assert isinstance(provider, StripePaymentProvider)
        yield provider
    registry._load.cache_clear()


def intent(**fields: Any) -> Any:
    return stripe.PaymentIntent.construct_from({"object": "payment_intent", **fields}, "sk_test")


def post_raw(payload: bytes, client: APIClient | None = None, **headers: Any) -> Any:
    """POST the exact bytes (signatures cover the raw body, so nothing may re-serialise it)."""
    return (client or APIClient()).post(
        WEBHOOK, data=payload, content_type="application/json", **headers
    )


def deliver(payload: bytes, signature: str | None = None) -> Any:
    return post_raw(
        payload, HTTP_STRIPE_SIGNATURE=signature if signature is not None else fx.sign(payload)
    )


@pytest.fixture
def pending_order(
    stripe_store: StripePaymentProvider, customer: User, product: Product
) -> Callable[..., Order]:
    """Place an order through the real checkout with Stripe answering 'succeeded'."""

    def _place(reference: str = "pi_test_123") -> Order:
        CartItem.objects.filter(cart__user=customer).delete()
        add_to_cart(customer, product, 2)
        client = APIClient()
        client.force_authenticate(customer)
        with mock.patch.object(
            StripePaymentProvider, "charge", return_value=ChargeResult(True, reference)
        ):
            response = checkout(client)
        assert response.status_code == 202, response.data
        return Order.objects.get(pk=response.data["id"])

    return _place


def succeeded(order: Order, **overrides: Any) -> bytes:
    fields: dict[str, Any] = {"amount": to_minor_units(order.total, order.currency)}
    fields.update(overrides)
    return fx.event("payment_intent.succeeded", fx.payment_intent(str(order.pk), **fields))


class TestMinorUnits:
    @pytest.mark.parametrize(
        ("amount", "currency", "expected"),
        [
            ("53.99", "USD", 5399),
            ("0.10", "EUR", 10),
            ("1200", "JPY", 1200),
            ("19.995", "USD", 2000),
        ],
    )
    def test_conversion(self, amount: str, currency: str, expected: int) -> None:
        assert to_minor_units(Decimal(amount), currency) == expected

    def test_negative_amounts_are_refused(self) -> None:
        with pytest.raises(ValueError, match="negative"):
            to_minor_units(Decimal("-1"), "USD")


class TestConfiguration:
    def _build(self, **overrides: Any) -> StripePaymentProvider:
        with override_settings(**{**STRIPE, **overrides}):
            return StripePaymentProvider()

    def test_requires_a_secret_key(self) -> None:
        with pytest.raises(ImproperlyConfigured, match="STRIPE_SECRET_KEY"):
            self._build(STRIPE_SECRET_KEY="")

    def test_requires_a_webhook_secret(self) -> None:
        with pytest.raises(ImproperlyConfigured, match="STRIPE_WEBHOOK_SECRET"):
            self._build(STRIPE_WEBHOOK_SECRET="")

    @pytest.mark.parametrize("key", ["sk_live_abc", "rk_live_abc"])
    def test_refuses_live_keys_by_default(self, key: str) -> None:
        with pytest.raises(ImproperlyConfigured, match="live Stripe key"):
            self._build(STRIPE_SECRET_KEY=key)

    def test_live_mode_is_an_explicit_opt_in(self) -> None:
        provider = self._build(STRIPE_SECRET_KEY="sk_live_abc", STRIPE_ALLOW_LIVE_MODE=True)
        assert provider.public_config().mode == "live"
        assert provider.public_config().test_methods == []

    def test_public_config_endpoint(self, api: APIClient, stripe_store: Any) -> None:
        body = api.get("/api/payments/config/").json()
        assert body["provider"] == "stripe"
        assert body["mode"] == "test"
        assert body["confirms_asynchronously"] is True
        assert [m["token"] for m in body["test_methods"]] == [
            "pm_card_visa",
            "pm_card_chargeDeclined",
        ]
        assert "sk_" not in str(body)
        assert "whsec" not in str(body)

    def test_mock_is_the_default(self, api: APIClient) -> None:
        body = api.get("/api/payments/config/").json()
        assert body["provider"] == "mock"
        assert body["mode"] == "offline"
        assert body["confirms_asynchronously"] is False


class TestCharge:
    def test_request_shape(self, stripe_store: StripePaymentProvider) -> None:
        with mock.patch.object(
            stripe_store.client.v1.payment_intents,
            "create",
            return_value=intent(id="pi_1", status="succeeded"),
        ) as create:
            result = stripe_store.charge(
                amount=Decimal("60.99"),
                currency="USD",
                payment_token="pm_card_visa",
                idempotency_key="order-uuid",
            )
        assert result == ChargeResult(True, "pi_1")
        params = create.call_args.kwargs["params"]
        assert params["amount"] == 6099
        assert params["currency"] == "usd"
        assert params["confirm"] is True
        assert params["metadata"] == {"order_id": "order-uuid"}
        assert params["automatic_payment_methods"]["allow_redirects"] == "never"
        assert create.call_args.kwargs["options"] == {"idempotency_key": "charge-order-uuid"}

    @pytest.mark.parametrize(
        ("status", "success", "pending"),
        [
            ("succeeded", True, False),
            ("processing", False, True),
            ("requires_action", False, True),
            ("requires_payment_method", False, False),
            ("canceled", False, False),
        ],
    )
    def test_status_mapping(
        self, stripe_store: StripePaymentProvider, status: str, success: bool, pending: bool
    ) -> None:
        with mock.patch.object(
            stripe_store.client.v1.payment_intents,
            "create",
            return_value=intent(id="pi", status=status),
        ):
            result = stripe_store.charge(
                amount=Decimal(1), currency="USD", payment_token="pm", idempotency_key="k"
            )
        assert (result.success, result.pending) == (success, pending)

    def test_decline_is_final(self, stripe_store: StripePaymentProvider) -> None:
        error = stripe.CardError("Your card was declined.", None, "card_declined")  # type: ignore[no-untyped-call]
        with mock.patch.object(stripe_store.client.v1.payment_intents, "create", side_effect=error):
            result = stripe_store.charge(
                amount=Decimal(1),
                currency="USD",
                payment_token="pm_card_chargeDeclined",
                idempotency_key="k",
            )
        assert not result.success
        assert not result.pending
        assert "declined" in result.failure_reason

    def test_unknown_outcome_is_pending_never_declined(self) -> None:
        # Nothing listens on port 9: the request fails at the network layer, exactly like a
        # timeout after Stripe might have captured the money.
        registry._load.cache_clear()
        with override_settings(**{**STRIPE, "STRIPE_API_BASE": "http://127.0.0.1:9"}):
            result = StripePaymentProvider().charge(
                amount=Decimal(1), currency="USD", payment_token="pm_card_visa", idempotency_key="k"
            )
        assert result.pending
        assert not result.success

    def test_rejected_request_is_a_plain_failure(self, stripe_store: StripePaymentProvider) -> None:
        error = stripe.InvalidRequestError("No such PaymentMethod", "payment_method")  # type: ignore[no-untyped-call]
        with mock.patch.object(stripe_store.client.v1.payment_intents, "create", side_effect=error):
            result = stripe_store.charge(
                amount=Decimal(1), currency="USD", payment_token="pm_bogus", idempotency_key="k"
            )
        assert (result.success, result.pending) == (False, False)


@pytest.mark.skipif(not STRIPE_MOCK_URL, reason="set STRIPE_MOCK_URL to run against stripe-mock")
class TestAgainstStripeMock:
    """Real HTTP against stripe/stripe-mock, which validates every request against Stripe's
    OpenAPI spec. Its answers are canned fixtures, so these prove request validity and
    response handling, not card behaviour."""

    def test_charge_is_a_valid_payment_intent_request(
        self, stripe_store: StripePaymentProvider
    ) -> None:
        result = stripe_store.charge(
            amount=Decimal("60.99"),
            currency="USD",
            payment_token="pm_card_visa",
            idempotency_key="o-1",
        )
        assert result.reference.startswith("pi_")
        # stripe-mock's fixture is always requires_payment_method: mapped to a failure.
        assert (result.success, result.pending) == (False, False)

    def test_refund_retrieve_and_cancel(self, stripe_store: StripePaymentProvider) -> None:
        refund = stripe_store.refund(
            reference="pi_123", amount=Decimal("10.00"), currency="USD", idempotency_key="o-1"
        )
        assert refund.success
        assert refund.reference.startswith("re_")
        assert stripe_store.retrieve("pi_123").reference.startswith("pi_")
        stripe_store.cancel("pi_123")  # must not raise

    def test_checkout_end_to_end_through_the_api(
        self, stripe_store: Any, customer: User, product: Product
    ) -> None:
        add_to_cart(customer, product)
        client = APIClient()
        client.force_authenticate(customer)
        response = checkout(client, token="pm_card_visa")
        # The canned intent never succeeds, so the order is declined and stock released.
        assert response.status_code == 402
        product.refresh_from_db()
        assert product.stock == 10


class TestCheckoutWithStripe:
    def test_accepted_payment_waits_for_the_webhook(
        self, pending_order: Callable[..., Order], customer: User, product: Product
    ) -> None:
        order = pending_order()
        assert order.status == OrderStatus.PENDING_PAYMENT
        assert order.payment_provider == "stripe"
        assert order.payment_reference == "pi_test_123"
        product.refresh_from_db()
        assert product.stock == 8  # reserved
        assert CartItem.objects.filter(cart__user=customer).exists()  # bag kept until paid

    def test_unknown_outcome_keeps_the_reservation(
        self, stripe_store: Any, customer: User, product: Product
    ) -> None:
        add_to_cart(customer, product)
        client = APIClient()
        client.force_authenticate(customer)
        unknown = ChargeResult(False, "", "Payment confirmation is delayed.", pending=True)
        with mock.patch.object(StripePaymentProvider, "charge", return_value=unknown):
            response = checkout(client)
        assert response.status_code == 202
        product.refresh_from_db()
        assert product.stock == 9

    def test_replay_of_a_pending_attempt_is_still_accepted(
        self, stripe_store: Any, customer: User, product: Product
    ) -> None:
        add_to_cart(customer, product)
        client = APIClient()
        client.force_authenticate(customer)
        with mock.patch.object(
            StripePaymentProvider, "charge", return_value=ChargeResult(True, "pi_x")
        ) as charge:
            first = checkout(client, key="same-key-123")
            second = checkout(client, key="same-key-123")
        assert first.status_code == second.status_code == 202
        assert first.data["id"] == second.data["id"]
        assert charge.call_count == 1


class TestWebhookAuthenticity:
    def test_missing_signature(self, pending_order: Callable[..., Order]) -> None:
        order = pending_order()
        response = post_raw(succeeded(order))
        assert response.status_code == 400
        order.refresh_from_db()
        assert order.status == OrderStatus.PENDING_PAYMENT

    def test_wrong_secret(self, pending_order: Callable[..., Order]) -> None:
        order = pending_order()
        payload = succeeded(order)
        assert deliver(payload, fx.sign(payload, "whsec_attacker")).status_code == 400

    def test_tampered_body(self, pending_order: Callable[..., Order]) -> None:
        order = pending_order()
        payload = succeeded(order)
        signature = fx.sign(payload)
        tampered = payload.replace(b'"amount_received":', b'"amount_received":1')
        assert deliver(tampered, signature).status_code == 400

    def test_stale_timestamp_is_a_replay(self, pending_order: Callable[..., Order]) -> None:
        order = pending_order()
        payload = succeeded(order)
        old = int(time.time()) - 301
        assert deliver(payload, fx.sign(payload, timestamp=old)).status_code == 400
        order.refresh_from_db()
        assert order.status == OrderStatus.PENDING_PAYMENT

    def test_rotated_secret_with_several_signatures(
        self, pending_order: Callable[..., Order]
    ) -> None:
        order = pending_order()
        payload = succeeded(order)
        signature = fx.sign(payload, extra_v1=["0" * 64])
        assert deliver(payload, signature).status_code == 200

    def test_live_event_is_refused_by_a_test_store(
        self, pending_order: Callable[..., Order]
    ) -> None:
        order = pending_order()
        payload = fx.event(
            "payment_intent.succeeded",
            fx.payment_intent(str(order.pk), amount=to_minor_units(order.total, "USD")),
            livemode=True,
        )
        assert deliver(payload).status_code == 400

    def test_signed_garbage_is_rejected(self, stripe_store: Any) -> None:
        payload = b"not json"
        assert deliver(payload).status_code == 400

    def test_only_post(self, stripe_store: Any) -> None:
        assert APIClient().get(WEBHOOK).status_code == 405

    def test_disabled_without_a_webhook_secret(self, api: APIClient) -> None:
        payload = fx.event("payment_intent.succeeded", fx.payment_intent("x"))
        assert deliver(payload).status_code == 400


class TestWebhookEffects:
    def test_success_marks_the_order_paid_and_empties_the_bag(
        self, pending_order: Callable[..., Order], customer: User
    ) -> None:
        order = pending_order()
        response = deliver(succeeded(order))
        assert response.status_code == 200
        assert response.json()["outcome"] == "paid"
        order.refresh_from_db()
        assert order.status == OrderStatus.PAID
        assert order.paid_at is not None
        assert not CartItem.objects.filter(cart__user=customer).exists()
        assert WebhookEvent.objects.get().outcome == "paid"

    def test_replayed_event_changes_nothing(self, pending_order: Callable[..., Order]) -> None:
        order = pending_order()
        payload = succeeded(order, intent_id="pi_test_123")
        assert deliver(payload).json()["outcome"] == "paid"
        # Inside the tolerance window, re-signed with a fresh timestamp: still the same event.
        assert deliver(payload, fx.sign(payload, timestamp=int(time.time()) + 1)).json() == {
            "received": True,
            "outcome": "duplicate",
        }
        assert OrderEvent.objects.filter(order=order, to_status=OrderStatus.PAID).count() == 1

    def test_amount_mismatch_is_flagged_not_paid(self, pending_order: Callable[..., Order]) -> None:
        order = pending_order()
        assert deliver(succeeded(order, amount=1)).json()["outcome"] == "amount_mismatch"
        order.refresh_from_db()
        assert order.status == OrderStatus.PENDING_PAYMENT
        assert AuditLog.objects.filter(action="payment.amount_mismatch", target_id=str(order.pk))

    def test_currency_mismatch_is_flagged(self, pending_order: Callable[..., Order]) -> None:
        order = pending_order()
        assert deliver(succeeded(order, currency="eur")).json()["outcome"] == "amount_mismatch"

    @pytest.mark.parametrize("order_id", ["00000000-0000-0000-0000-000000000000", "not-a-uuid", ""])
    def test_events_for_unknown_orders_are_acknowledged_and_ignored(
        self, stripe_store: Any, order_id: str
    ) -> None:
        payload = fx.event("payment_intent.succeeded", fx.payment_intent(order_id))
        response = deliver(payload)
        assert response.status_code == 200
        assert response.json()["outcome"] == "unknown_order"

    def test_intent_must_match_the_stored_reference(
        self, pending_order: Callable[..., Order]
    ) -> None:
        order = pending_order(reference="pi_real")
        payload = succeeded(order, intent_id="pi_someone_else")
        assert deliver(payload).json()["outcome"] == "unknown_order"
        order.refresh_from_db()
        assert order.status == OrderStatus.PENDING_PAYMENT

    def test_webhook_can_beat_the_checkout_response(
        self, pending_order: Callable[..., Order]
    ) -> None:
        order = pending_order()
        Order.objects.filter(pk=order.pk).update(payment_reference="")
        assert deliver(succeeded(order, intent_id="pi_early")).json()["outcome"] == "paid"
        order.refresh_from_db()
        assert order.payment_reference == "pi_early"

    def test_orders_of_other_providers_are_out_of_reach(
        self, stripe_store: Any, customer: User, product: Product
    ) -> None:
        add_to_cart(customer, product)
        client = APIClient()
        client.force_authenticate(customer)
        registry._load.cache_clear()
        with override_settings(PAYMENT_PROVIDER="apps.payments.providers.mock.MockPaymentProvider"):
            order = Order.objects.get(pk=checkout(client).data["id"])
        registry._load.cache_clear()
        Order.objects.filter(pk=order.pk).update(status=OrderStatus.PENDING_PAYMENT)
        assert deliver(succeeded(order)).json()["outcome"] == "unknown_order"

    def test_late_success_for_a_cancelled_order_is_refunded(
        self, pending_order: Callable[..., Order]
    ) -> None:
        order = pending_order()
        abandoned = ChargeResult(False, "pi_test_123")
        with (
            override_settings(**STRIPE),
            mock.patch.object(StripePaymentProvider, "retrieve", return_value=abandoned),
            mock.patch.object(StripePaymentProvider, "cancel"),
        ):
            call_command("expire_pending_orders", "--minutes", "-1", stdout=StringIO())
        order.refresh_from_db()
        assert order.status == OrderStatus.CANCELLED
        with mock.patch.object(
            StripePaymentProvider, "refund", return_value=RefundResult(True, "re_1")
        ) as refund:
            assert deliver(succeeded(order)).json()["outcome"] == "refunded_late_payment"
        assert refund.call_args.kwargs["idempotency_key"] == f"late-{order.pk}"
        assert AuditLog.objects.filter(action="payment.late_payment_refunded")

    def test_failed_refund_is_retried_by_stripe(self, pending_order: Callable[..., Order]) -> None:
        order = pending_order()
        Order.objects.filter(pk=order.pk).update(status=OrderStatus.CANCELLED)
        payload = succeeded(order)
        client = APIClient()
        client.raise_request_exception = False
        with mock.patch.object(
            StripePaymentProvider, "refund", return_value=RefundResult(False, "")
        ):
            response = post_raw(payload, client, HTTP_STRIPE_SIGNATURE=fx.sign(payload))
        assert response.status_code == 500
        assert not WebhookEvent.objects.exists()  # rolled back: the retry will be processed
        with mock.patch.object(
            StripePaymentProvider, "refund", return_value=RefundResult(True, "re")
        ):
            assert deliver(payload).json()["outcome"] == "refunded_late_payment"

    def test_failure_releases_the_stock(
        self, pending_order: Callable[..., Order], product: Product, customer: User
    ) -> None:
        order = pending_order()
        payload = fx.event(
            "payment_intent.payment_failed",
            fx.payment_intent(
                str(order.pk), status="requires_payment_method", failure="Insufficient funds."
            ),
        )
        assert deliver(payload).json()["outcome"] == "payment_failed"
        order.refresh_from_db()
        assert order.status == OrderStatus.PAYMENT_FAILED
        assert order.failure_reason == "Insufficient funds."
        product.refresh_from_db()
        assert product.stock == 10
        assert CartItem.objects.filter(cart__user=customer).exists()

    def test_failure_after_success_is_ignored(self, pending_order: Callable[..., Order]) -> None:
        order = pending_order()
        deliver(succeeded(order))
        failed = fx.event(
            "payment_intent.payment_failed",
            fx.payment_intent(str(order.pk), status="requires_payment_method", failure="x"),
        )
        assert deliver(failed).json()["outcome"] == "already_settled"
        order.refresh_from_db()
        assert order.status == OrderStatus.PAID

    def test_cancellation_cancels_a_pending_order_but_never_a_paid_one(
        self, pending_order: Callable[..., Order]
    ) -> None:
        order = pending_order()
        canceled = fx.event(
            "payment_intent.canceled", fx.payment_intent(str(order.pk), status="canceled")
        )
        assert deliver(canceled).json()["outcome"] == "cancelled"

        second = pending_order(reference="pi_second")
        deliver(succeeded(second, intent_id="pi_second"))
        with mock.patch.object(StripePaymentProvider, "refund") as refund:
            again = fx.event(
                "payment_intent.canceled",
                fx.payment_intent(str(second.pk), intent_id="pi_second", status="canceled"),
            )
            assert deliver(again).json()["outcome"] == "already_settled"
        refund.assert_not_called()
        second.refresh_from_db()
        assert second.status == OrderStatus.PAID

    def test_other_event_types_are_recorded_and_ignored(self, stripe_store: Any) -> None:
        payload = fx.event("charge.refunded", {"id": "ch_1", "object": "charge"})
        assert deliver(payload).json()["outcome"] == "ignored"
        assert WebhookEvent.objects.get().event_type == "charge.refunded"


class TestReconciliation:
    def _expire(self) -> str:
        out = StringIO()
        with override_settings(**STRIPE):
            call_command("expire_pending_orders", "--minutes", "-1", stdout=out)
        return out.getvalue()

    def test_lost_webhook_success_is_reconciled_as_paid(
        self, pending_order: Callable[..., Order]
    ) -> None:
        order = pending_order()
        with mock.patch.object(
            StripePaymentProvider, "retrieve", return_value=ChargeResult(True, "pi_test_123")
        ):
            assert "reconciled 1 as paid" in self._expire()
        order.refresh_from_db()
        assert order.status == OrderStatus.PAID

    def test_processing_payments_are_left_alone(self, pending_order: Callable[..., Order]) -> None:
        order = pending_order()
        processing = ChargeResult(False, "pi_test_123", pending=True)
        with mock.patch.object(StripePaymentProvider, "retrieve", return_value=processing):
            assert "1 still processing" in self._expire()
        order.refresh_from_db()
        assert order.status == OrderStatus.PENDING_PAYMENT

    def test_abandoned_payments_are_cancelled_at_stripe_too(
        self, pending_order: Callable[..., Order], product: Product
    ) -> None:
        order = pending_order()
        with (
            mock.patch.object(
                StripePaymentProvider, "retrieve", return_value=ChargeResult(False, "pi")
            ),
            mock.patch.object(StripePaymentProvider, "cancel") as cancel,
        ):
            assert "Expired 1" in self._expire()
        cancel.assert_called_once_with("pi_test_123")
        order.refresh_from_db()
        assert order.status == OrderStatus.CANCELLED
        product.refresh_from_db()
        assert product.stock == 10
