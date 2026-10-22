from __future__ import annotations

import uuid
from collections.abc import Callable
from decimal import Decimal
from typing import Any

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.cart.models import Cart, CartItem
from apps.catalog.models import Category, Product
from apps.payments.providers.mock import APPROVE_TOKEN

PASSWORD = "Correct-Horse-42!"

ADDRESS = {
    "name": "Ada Lovelace",
    "line1": "12 Analytical Way",
    "city": "London",
    "postal_code": "EC1A 1BB",
    "country": "gb",
}


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    cache.clear()  # throttling state must not leak between tests


@pytest.fixture
def api() -> APIClient:
    return APIClient()


@pytest.fixture
def make_user(db: Any) -> Callable[..., User]:
    def _make(email: str | None = None, role: str = Role.CUSTOMER, **extra: Any) -> User:
        return User.objects.create_user(
            email=email or f"user-{uuid.uuid4().hex[:8]}@example.com",
            password=PASSWORD,
            full_name=extra.pop("full_name", "Test User"),
            role=role,
            **extra,
        )

    return _make


@pytest.fixture
def customer(make_user: Callable[..., User]) -> User:
    return make_user("customer@example.com")


@pytest.fixture
def other_customer(make_user: Callable[..., User]) -> User:
    return make_user("other@example.com")


@pytest.fixture
def admin(make_user: Callable[..., User]) -> User:
    return make_user("admin@example.com", role=Role.ADMIN)


def bearer(client: APIClient, user: User) -> APIClient:
    """Authenticate ``client`` with a real, signed access token for ``user``."""
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user).access}")
    return client


@pytest.fixture
def customer_api(customer: User) -> APIClient:
    return bearer(APIClient(), customer)


@pytest.fixture
def other_api(other_customer: User) -> APIClient:
    return bearer(APIClient(), other_customer)


@pytest.fixture
def admin_api(admin: User) -> APIClient:
    return bearer(APIClient(), admin)


@pytest.fixture
def category(db: Any) -> Category:
    return Category.objects.create(name="Audio", slug="audio")


@pytest.fixture
def make_product(category: Category) -> Callable[..., Product]:
    counter = iter(range(1, 10_000))

    def _make(**overrides: Any) -> Product:
        n = next(counter)
        fields: dict[str, Any] = {
            "name": f"Product {n}",
            "slug": f"product-{n}",
            "sku": f"SKU-{n:04d}",
            "category": category,
            "price": Decimal("20.00"),
            "stock": 10,
            "image_url": f"/products/product-{n}.svg",
        }
        fields.update(overrides)
        return Product.objects.create(**fields)

    return _make


@pytest.fixture
def product(make_product: Callable[..., Product]) -> Product:
    return make_product(name="Aurora Headphones", slug="aurora", sku="AUD-1", price="50.00")


def add_to_cart(user: User, product: Product, quantity: int = 1) -> CartItem:
    cart, _ = Cart.objects.get_or_create(user=user)
    return CartItem.objects.create(cart=cart, product=product, quantity=quantity)


def checkout(
    client: APIClient, key: str | None = None, token: str = APPROVE_TOKEN, **body: Any
) -> Any:
    payload = {"shipping_address": ADDRESS, "payment_token": token, **body}
    return client.post(
        "/api/checkout/", payload, format="json", HTTP_IDEMPOTENCY_KEY=key or uuid.uuid4().hex
    )
