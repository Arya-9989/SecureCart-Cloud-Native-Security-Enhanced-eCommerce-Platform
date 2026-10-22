"""Concurrency guarantees that only real parallel transactions can prove (PostgreSQL only)."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from decimal import Decimal

import pytest
from django.db import connection, connections
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from apps.accounts import tokens
from apps.accounts.models import User
from apps.cart.models import Cart, CartItem
from apps.catalog.models import Category, Product
from apps.orders import checkout
from apps.orders.models import Order, OrderStatus
from apps.payments.providers.mock import APPROVE_TOKEN

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
