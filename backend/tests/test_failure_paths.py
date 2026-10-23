"""Failure and race branches of the roadmap features: provider errors, lost races, outages."""

from __future__ import annotations

import importlib
from collections.abc import Iterator
from datetime import timedelta
from decimal import Decimal
from io import StringIO
from typing import Any
from unittest import mock

import pytest
import stripe
from botocore.exceptions import EndpointConnectionError
from django.core.cache import cache as django_cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from rest_framework.test import APIClient

import config.settings as settings_module
from apps.accounts.models import User
from apps.catalog import cache as catalog_cache
from apps.catalog import media
from apps.catalog.models import Product
from apps.core import scheduler
from apps.core.throttling import AtomicRateThrottle
from apps.orders import checkout as checkout_service
from apps.orders import state
from apps.orders.models import Order, OrderStatus
from apps.payments import registry, webhooks
from apps.payments.providers.base import ChargeResult
from apps.payments.providers.stripe_provider import StripePaymentProvider
from tests import stripe_fixtures as fx
from tests.conftest import add_to_cart, checkout

pytestmark = pytest.mark.django_db

STRIPE = {
    "PAYMENT_PROVIDER": "apps.payments.providers.stripe_provider.StripePaymentProvider",
    "STRIPE_SECRET_KEY": "sk_test_fixture",
    "STRIPE_WEBHOOK_SECRET": fx.WEBHOOK_SECRET,
    "STRIPE_API_BASE": "http://127.0.0.1:9",
    "STRIPE_MAX_NETWORK_RETRIES": 0,
}


@pytest.fixture
def stripe_store() -> Iterator[StripePaymentProvider]:
    registry._load.cache_clear()
    with override_settings(**STRIPE):
        provider = registry.get_payment_provider()
        assert isinstance(provider, StripePaymentProvider)
        yield provider
    registry._load.cache_clear()


@pytest.fixture
def pending(stripe_store: Any, customer: User, product: Product) -> Order:
    add_to_cart(customer, product)
    client = APIClient()
    client.force_authenticate(customer)
    with mock.patch.object(
        StripePaymentProvider, "charge", return_value=ChargeResult(True, "pi_1")
    ):
        response = checkout(client)
    return Order.objects.get(pk=response.data["id"])


class TestStripeProviderErrors:
    def test_refund_failure_is_reported_not_raised(
        self, stripe_store: StripePaymentProvider
    ) -> None:
        error = stripe.APIConnectionError("down")  # type: ignore[no-untyped-call]
        with mock.patch.object(stripe_store.client.v1.refunds, "create", side_effect=error):
            result = stripe_store.refund(reference="pi", amount=Decimal(1), currency="USD")
        assert not result.success

    def test_lookup_failure_counts_as_still_pending(
        self, stripe_store: StripePaymentProvider
    ) -> None:
        error = stripe.APIConnectionError("down")  # type: ignore[no-untyped-call]
        with mock.patch.object(
            stripe_store.client.v1.payment_intents, "retrieve", side_effect=error
        ):
            assert stripe_store.retrieve("pi").pending

    def test_cancel_of_a_settled_intent_is_ignored(
        self, stripe_store: StripePaymentProvider
    ) -> None:
        error = stripe.InvalidRequestError("already succeeded", "intent")  # type: ignore[no-untyped-call]
        with mock.patch.object(stripe_store.client.v1.payment_intents, "cancel", side_effect=error):
            stripe_store.cancel("pi")  # must not raise


class TestWebhookRaces:
    def _intent(self, order: Order, **kw: Any) -> dict[str, Any]:
        return fx.payment_intent(
            str(order.pk), intent_id="pi_1", amount=int(order.total * 100), **kw
        )

    def test_event_without_an_object_is_invalid(self, stripe_store: Any) -> None:
        body = b'{"id":"evt_x","object":"event","type":"x","livemode":false,"data":{}}'
        with pytest.raises(webhooks.InvalidWebhook, match="no object"):
            webhooks.verify(body, fx.sign(body))

    def test_success_that_loses_a_race_with_a_cancellation_is_refunded(
        self, pending: Order
    ) -> None:
        def cancelled_meanwhile(*args: Any, **kwargs: Any) -> Order:
            Order.objects.filter(pk=pending.pk).update(status=OrderStatus.CANCELLED)
            raise state.InvalidTransition("pending_payment", "paid")

        with (
            mock.patch.object(checkout_service, "finalize_paid", side_effect=cancelled_meanwhile),
            mock.patch.object(checkout_service, "refund_late_payment", return_value=True),
        ):
            assert webhooks._on_succeeded(self._intent(pending)) == "refunded_late_payment"

    def test_success_for_a_shipped_order_changes_nothing(self, pending: Order) -> None:
        Order.objects.filter(pk=pending.pk).update(status=OrderStatus.SHIPPED)
        assert webhooks._on_succeeded(self._intent(pending)) == "already_settled"

    def test_failure_and_cancellation_for_unknown_orders(self, stripe_store: Any) -> None:
        intent = fx.payment_intent("00000000-0000-0000-0000-000000000000")
        assert webhooks._on_failed(intent) == "unknown_order"
        assert webhooks._on_canceled(intent) == "unknown_order"

    def test_cancellation_that_loses_a_race(self, pending: Order) -> None:
        with mock.patch.object(state, "transition", side_effect=state.InvalidTransition("a", "b")):
            assert (
                webhooks._on_canceled(self._intent(pending, status="canceled")) == "already_settled"
            )

    def test_mark_failed_after_settlement_is_a_no_op(self, pending: Order) -> None:
        Order.objects.filter(pk=pending.pk).update(status=OrderStatus.PAID)
        order = checkout_service.mark_failed(pending, "late failure")
        assert order.status == OrderStatus.PAID


class TestReconciliationRaces:
    def test_orders_settled_concurrently_are_skipped(self, pending: Order) -> None:
        with (
            override_settings(**STRIPE),
            mock.patch.object(
                StripePaymentProvider, "retrieve", return_value=ChargeResult(True, "pi_1")
            ),
            mock.patch.object(
                checkout_service, "finalize_paid", side_effect=state.InvalidTransition("a", "b")
            ),
        ):
            out = StringIO()
            call_command("expire_pending_orders", "--minutes", "-1", stdout=out)
        assert "reconciled 0 as paid" in out.getvalue()

    def test_cancellation_lost_to_a_concurrent_settlement(
        self, customer: User, product: Product
    ) -> None:
        add_to_cart(customer, product)
        client = APIClient()
        client.force_authenticate(customer)
        order = Order.objects.get(pk=checkout(client).data["id"])
        Order.objects.filter(pk=order.pk).update(status=OrderStatus.PENDING_PAYMENT)
        with mock.patch.object(state, "transition", side_effect=state.InvalidTransition("a", "b")):
            out = StringIO()
            call_command("expire_pending_orders", "--minutes", "-1", stdout=out)
        assert "Expired 0" in out.getvalue()


class TestMediaInit:
    def test_nothing_to_do_without_s3(self) -> None:
        out = StringIO()
        with override_settings(MEDIA_STORAGE="memory"):
            call_command("init_media_storage", stdout=out)
        assert "not S3" in out.getvalue()

    def test_gives_up_after_retries(self) -> None:
        media._s3.cache_clear()
        error = EndpointConnectionError(endpoint_url="http://minio:9000")
        try:
            with (
                override_settings(MEDIA_STORAGE="s3", MEDIA_S3_ENDPOINT="http://127.0.0.1:9"),
                mock.patch.object(media.S3Storage, "ensure_bucket", side_effect=error) as ensure,
                mock.patch("time.sleep"),
                pytest.raises(CommandError, match="unreachable"),
            ):
                call_command("init_media_storage")
            assert ensure.call_count == 10
        finally:
            media._s3.cache_clear()

    def test_recovers_once_the_store_answers(self) -> None:
        media._s3.cache_clear()
        error = EndpointConnectionError(endpoint_url="http://minio:9000")
        try:
            with (
                override_settings(MEDIA_STORAGE="s3", MEDIA_S3_ENDPOINT="http://127.0.0.1:9"),
                mock.patch.object(media.S3Storage, "ensure_bucket", side_effect=[error, None]),
                mock.patch("time.sleep"),
            ):
                out = StringIO()
                call_command("init_media_storage", stdout=out)
            assert "is ready" in out.getvalue()
        finally:
            media._s3.cache_clear()

    def test_unknown_storage_setting_is_refused(self) -> None:
        from django.core.exceptions import ImproperlyConfigured  # noqa: PLC0415

        with override_settings(MEDIA_STORAGE="ftp"), pytest.raises(ImproperlyConfigured):
            media.storage()


class TestCatalogCacheOutages:
    def test_failed_invalidation_is_logged_not_raised(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        broken = mock.Mock()
        broken.incr.side_effect = ConnectionError("down")
        with mock.patch.object(catalog_cache, "cache", broken):
            catalog_cache.bump()
        assert "invalidation failed" in caplog.text

    def test_counter_recreated_when_evicted(self) -> None:
        django_cache.delete(catalog_cache.VERSION_KEY)
        catalog_cache.bump()
        assert catalog_cache.version() > 1_000_000

    def test_failed_write_still_answers(self, api: APIClient, product: Product) -> None:
        real = django_cache
        flaky = mock.Mock(wraps=real)
        flaky.set.side_effect = ConnectionError("down")
        with mock.patch.object(catalog_cache, "cache", flaky):
            response = api.get("/api/products/")
        assert response.status_code == 200
        assert response["X-Cache"] == "MISS"


class TestSchedulerLoop:
    def test_signal_handlers_and_logged_stop(self) -> None:
        loop = scheduler.Scheduler([], tick_seconds=0)
        with mock.patch("signal.signal") as install:
            loop.install_signal_handlers()
        assert install.call_count == 2
        loop.stop(15, None)
        assert loop.stopping.is_set()

    def test_a_crashing_job_lookup_does_not_kill_the_loop(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        job = scheduler.Job("broken", every=timedelta(minutes=1), run=lambda: None)
        with mock.patch.object(scheduler.Job, "run_if_due", side_effect=RuntimeError("db down")):
            assert scheduler.Scheduler([job]).tick() == []
        assert "could not run job=broken" in caplog.text

    def test_command_runs_until_stopped(self, tmp_path: Any) -> None:
        with (
            mock.patch.object(scheduler.Scheduler, "install_signal_handlers") as install,
            mock.patch.object(scheduler.Scheduler, "run_forever") as forever,
        ):
            call_command("run_scheduler", "--heartbeat", str(tmp_path / "hb"))
        install.assert_called_once()
        forever.assert_called_once()


class TestThrottleEdges:
    def test_no_rate_and_no_key_mean_no_limit(self) -> None:
        class Unlimited(AtomicRateThrottle):
            scope = "unlimited"

            def get_rate(self) -> str | None:
                return None

        assert Unlimited().allow_request(mock.Mock(), mock.Mock())

        class Keyless(AtomicRateThrottle):
            scope = "anon"

            def get_cache_key(self, request: Any, view: Any) -> str | None:
                return None

        assert Keyless().allow_request(mock.Mock(), mock.Mock())


class TestCacheSettings:
    def test_redis_backend_needs_a_url(self) -> None:
        from django.core.exceptions import ImproperlyConfigured  # noqa: PLC0415

        try:
            with (
                mock.patch.dict("os.environ", {"DJANGO_CACHE_BACKEND": "redis", "REDIS_URL": ""}),
                pytest.raises(ImproperlyConfigured, match="REDIS_URL"),
            ):
                importlib.reload(settings_module)
        finally:
            importlib.reload(settings_module)

    def test_redis_backend_configuration(self) -> None:
        try:
            with mock.patch.dict("os.environ", {"REDIS_URL": "redis://cache:6379/0"}):
                module = importlib.reload(settings_module)
                cache = module.CACHES["default"]
                assert cache["BACKEND"] == "django.core.cache.backends.redis.RedisCache"
                assert cache["OPTIONS"]["socket_timeout"] == 0.5
        finally:
            importlib.reload(settings_module)
