"""Concurrency guarantees that only real parallel transactions can prove (PostgreSQL only)."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from decimal import Decimal
from unittest import mock

import pytest
from django.conf import settings
from django.db import OperationalError, connection, connections, transaction
from django.test import override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from apps.accounts import onetime, tokens
from apps.accounts.models import TokenPurpose, User
from apps.cart.models import Cart, CartItem
from apps.catalog.models import Category, Product
from apps.orders import checkout, state
from apps.orders.models import Order, OrderEvent, OrderStatus
from apps.payments import registry
from apps.payments.models import WebhookEvent
from apps.payments.money import to_minor_units
from apps.payments.providers.base import ChargeResult, RefundResult
from apps.payments.providers.mock import APPROVE_TOKEN, MockPaymentProvider
from tests import stripe_fixtures as fx

BUYERS = 8
STOCK = 3


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_parallel_checkouts_never_oversell() -> None:
    if connection.vendor != "postgresql":
        pytest.skip("SELECT ... FOR UPDATE semantics require PostgreSQL")

    category = Category.objects.create(name="Limited", slug="limited")
    product = Product.objects.create(
        name="Limited Drop",
        slug="limited-drop",
        sku="LTD-1",
        category=category,
        price=Decimal("10.00"),
        stock=STOCK,
    )
    buyers = []
    for i in range(BUYERS):
        user = User.objects.create_user(f"buyer{i}@example.com", "x" * 12, full_name=f"B{i}")
        CartItem.objects.create(cart=Cart.objects.create(user=user), product=product, quantity=1)
        buyers.append(user)

    barrier = threading.Barrier(BUYERS)
    outcomes: list[str] = []
    lock = threading.Lock()

    def buy(user: User) -> None:
        try:
            barrier.wait()
            checkout.place_order(
                user,
                address=checkout.ShippingAddress("B", "1 Main St", "Town", "12345", "US"),
                payment_token=APPROVE_TOKEN,
                idempotency_key=uuid.uuid4().hex,
            )
            result = "ok"
        except checkout.InsufficientStock:
            result = "sold_out"
        finally:
            connections.close_all()
        with lock:
            outcomes.append(result)

    threads = [threading.Thread(target=buy, args=(u,)) for u in buyers]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    product.refresh_from_db()
    assert outcomes.count("ok") == STOCK
    assert outcomes.count("sold_out") == BUYERS - STOCK
    assert product.stock == 0
    assert Order.objects.filter(status=OrderStatus.PAID).count() == STOCK


def _race(workers: int, work: Callable[[], object]) -> list[object]:
    """Run ``work()`` in ``workers`` threads released together; return each outcome."""
    barrier = threading.Barrier(workers)
    outcomes: list[object] = []
    lock = threading.Lock()

    def run() -> None:
        try:
            barrier.wait()
            result: object = work()
        except Exception as exc:  # the outcome under test
            result = exc
        finally:
            connections.close_all()
        with lock:
            outcomes.append(result)

    threads = [threading.Thread(target=run) for _ in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    return outcomes


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_parallel_retries_with_one_key_place_one_order() -> None:
    """A double-click (or a retry storm) for the last unit: one order, the same answer for all."""
    if connection.vendor != "postgresql":
        pytest.skip("SELECT ... FOR UPDATE semantics require PostgreSQL")
    category = Category.objects.create(name="Limited", slug="limited")
    product = Product.objects.create(
        name="Last One",
        slug="last-one",
        sku="LST-1",
        category=category,
        price=Decimal("10.00"),
        stock=1,
    )
    user = User.objects.create_user("retry@example.com", "x" * 12, full_name="R")
    CartItem.objects.create(cart=Cart.objects.create(user=user), product=product, quantity=1)

    outcomes = _race(
        6,
        lambda: checkout.place_order(
            user,
            address=checkout.ShippingAddress("R", "1 Main St", "Town", "12345", "US"),
            payment_token=APPROVE_TOKEN,
            idempotency_key="one-key-for-all",
        ),
    )
    assert all(isinstance(o, checkout.CheckoutResult) for o in outcomes), outcomes
    results = [o for o in outcomes if isinstance(o, checkout.CheckoutResult)]
    assert len({r.order.pk for r in results}) == 1
    assert sum(not r.replayed for r in results) == 1
    product.refresh_from_db()
    assert product.stock == 0
    assert Order.objects.count() == 1


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_parallel_refreshes_with_one_token_never_both_succeed() -> None:
    """Racing the legitimate client with a stolen token must not mint two live sessions."""
    if connection.vendor != "postgresql":
        pytest.skip("needs real concurrent transactions")
    user = User.objects.create_user("race@example.com", "x" * 12, full_name="R")
    raw = tokens.issue_tokens(user).refresh

    outcomes = _race(6, lambda: tokens.rotate(raw))
    assert sum(not isinstance(o, Exception) for o in outcomes) <= 1
    assert all(
        isinstance(o, tokens.RefreshRejected) for o in outcomes if isinstance(o, Exception)
    ), outcomes
    if any(o.reuse_detected_for for o in outcomes if isinstance(o, tokens.RefreshRejected)):
        # Reuse was detected, so every token in the family, including the winner's, is dead.
        assert not OutstandingToken.objects.filter(user=user, blacklistedtoken__isnull=True)


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_refund_is_requested_without_holding_stock_locks() -> None:
    """Cancelling a paid order calls the provider; checkouts must not queue behind that call."""
    if connection.vendor != "postgresql":
        pytest.skip("row locks need PostgreSQL")
    category = Category.objects.create(name="Audio", slug="audio")
    product = Product.objects.create(
        name="Speaker",
        slug="speaker",
        sku="SPK-1",
        category=category,
        price=Decimal("10.00"),
        stock=5,
    )
    user = User.objects.create_user("refund@example.com", "x" * 12, full_name="R")
    CartItem.objects.create(cart=Cart.objects.create(user=user), product=product, quantity=1)
    order = checkout.place_order(
        user,
        address=checkout.ShippingAddress("R", "1 Main St", "Town", "12345", "US"),
        payment_token=APPROVE_TOKEN,
        idempotency_key="refund-lock-1",
    ).order

    probe: dict[str, bool] = {}

    def refund(**kwargs: object) -> RefundResult:
        def try_lock() -> None:
            try:
                with transaction.atomic():
                    Product.objects.select_for_update(nowait=True).get(pk=product.pk)
                probe["product_locked"] = False
            except OperationalError:
                probe["product_locked"] = True
            finally:
                connections.close_all()

        t = threading.Thread(target=try_lock)
        t.start()
        t.join(timeout=10)
        return RefundResult(True, "mock_re_probe")

    with mock.patch.object(MockPaymentProvider, "refund", side_effect=refund):
        state.transition(order, OrderStatus.CANCELLED)
    assert probe == {"product_locked": False}
    product.refresh_from_db()
    assert product.stock == 5


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_parallel_resets_with_one_link_succeed_exactly_once() -> None:
    """Two tabs (or an attacker racing the owner) submitting one reset link: one wins."""
    if connection.vendor != "postgresql":
        pytest.skip("row locks need PostgreSQL")
    user = User.objects.create_user("reset-race@example.com", "x" * 12, full_name="R")
    raw = onetime.issue(user, TokenPurpose.RESET_PASSWORD)
    passwords = iter(f"Racer-{n}-Strong-Pass" for n in range(6))

    def submit() -> int:
        response = APIClient().post(
            "/api/auth/password/reset/", {"token": raw, "new_password": next(passwords)}
        )
        return int(response.status_code)

    outcomes = _race(6, submit)
    assert sorted(str(o) for o in outcomes) == ["200"] + ["400"] * 5, outcomes


def _rotate_and_revoke(user: User) -> list[tokens.TokenPair]:
    """Run one rotation and one full revocation at the same instant; return minted pairs."""
    raw = tokens.issue_tokens(User.objects.get(pk=user.pk)).refresh
    minted: list[tokens.TokenPair] = []

    def rotate() -> None:
        minted.append(tokens.rotate(raw)[1])

    def revoke() -> None:
        tokens.revoke_all(User.objects.get(pk=user.pk))

    jobs = iter([rotate, revoke])
    _race(2, lambda: next(jobs)())  # noqa: PLW0108 - each thread takes the next job
    return minted


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_refresh_racing_a_revocation_never_leaves_a_live_session() -> None:
    """revoke_all (a password reset) and a refresh rotation interleave: nothing may survive."""
    if connection.vendor != "postgresql":
        pytest.skip("needs real concurrent transactions")
    user = User.objects.create_user("revoke-race@example.com", "x" * 12, full_name="R")
    for _ in range(8):
        for pair in _rotate_and_revoke(user):
            client = APIClient()
            client.cookies[settings.REFRESH_COOKIE["NAME"]] = pair.refresh
            assert client.post("/api/auth/refresh/", HTTP_X_CSRF_PROTECTION="1").status_code == 401
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {pair.access}")
            assert client.get("/api/auth/me/").status_code == 401


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_concurrent_deliveries_of_one_webhook_apply_once() -> None:
    """Stripe may deliver an event twice at once; the order must be paid exactly once."""
    if connection.vendor != "postgresql":
        pytest.skip("needs real concurrent transactions")
    category = Category.objects.create(name="Hooks", slug="hooks")
    product = Product.objects.create(
        name="Hook", slug="hook", sku="HK-1", category=category, price=Decimal("10.00"), stock=5
    )
    user = User.objects.create_user("hook@example.com", "x" * 12, full_name="H")
    CartItem.objects.create(cart=Cart.objects.create(user=user), product=product, quantity=1)
    stripe_settings = {
        "PAYMENT_PROVIDER": "apps.payments.providers.stripe_provider.StripePaymentProvider",
        "STRIPE_SECRET_KEY": "sk_test_fixture",
        "STRIPE_WEBHOOK_SECRET": fx.WEBHOOK_SECRET,
    }
    registry._load.cache_clear()
    try:
        with override_settings(**stripe_settings):
            with mock.patch(
                "apps.payments.providers.stripe_provider.StripePaymentProvider.charge",
                return_value=ChargeResult(True, "pi_race"),
            ):
                order = checkout.place_order(
                    user,
                    address=checkout.ShippingAddress("H", "1 Main St", "Town", "12345", "US"),
                    payment_token="pm_card_visa",
                    idempotency_key="hook-race-1",
                ).order
            payload = fx.event(
                "payment_intent.succeeded",
                fx.payment_intent(
                    str(order.pk), intent_id="pi_race", amount=to_minor_units(order.total, "USD")
                ),
                event_id="evt_race",
            )

            def deliver() -> str:
                response = APIClient().post(
                    "/api/payments/webhooks/stripe/",
                    data=payload,
                    content_type="application/json",
                    HTTP_STRIPE_SIGNATURE=fx.sign(payload),
                )
                return str(response.json()["outcome"])

            outcomes = _race(6, deliver)
    finally:
        registry._load.cache_clear()
    assert sorted(str(o) for o in outcomes) == ["duplicate"] * 5 + ["paid"], outcomes
    assert WebhookEvent.objects.filter(event_id="evt_race").count() == 1
    assert OrderEvent.objects.filter(order=order, to_status=OrderStatus.PAID).count() == 1
