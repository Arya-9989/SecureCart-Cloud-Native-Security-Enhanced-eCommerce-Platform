"""Populate a realistic demo store: catalog, accounts and 30 days of order history.

Orders are created through the real checkout service (so stock, totals and the state
machine behave exactly as in production) and then back-dated to give the dashboard a
meaningful history. The command is idempotent: re-running it never duplicates data.
"""

from __future__ import annotations

import os
import random
import uuid
from datetime import timedelta
from typing import Any

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from apps.accounts.models import Role, User
from apps.cart.models import Cart, CartItem
from apps.catalog.demo_data import CATEGORIES, PRODUCTS
from apps.catalog.models import Category, Product
from apps.orders import checkout, state
from apps.orders.models import Order, OrderEvent, OrderStatus
from apps.payments.providers.mock import APPROVE_TOKEN, DECLINE_TOKEN

DEFAULT_ADMIN_PASSWORD = "SecureCart!Admin1"  # noqa: S105 - documented demo credential
DEFAULT_CUSTOMER_PASSWORD = "SecureCart!Demo1"  # noqa: S105

DEMO_CUSTOMERS = [
    ("maya@example.com", "Maya Patel"),
    ("liam@example.com", "Liam Chen"),
    ("sofia@example.com", "Sofia Garcia"),
    ("noah@example.com", "Noah Williams"),
    ("aisha@example.com", "Aisha Khan"),
    ("lucas@example.com", "Lucas Martin"),
]
CITIES = [
    ("Austin", "78701", "US"),
    ("Seattle", "98101", "US"),
    ("Toronto", "M5V 2T6", "CA"),
    ("London", "EC1A 1BB", "GB"),
    ("Berlin", "10115", "DE"),
    ("Pune", "411001", "IN"),
]


class Command(BaseCommand):
    help = "Seed demo catalog, users and order history (idempotent)."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--admin-email", default="admin@securecart.dev")
        parser.add_argument(
            "--admin-password",
            default=os.environ.get("DEMO_ADMIN_PASSWORD") or DEFAULT_ADMIN_PASSWORD,
        )
        parser.add_argument(
            "--customer-password",
            default=os.environ.get("DEMO_CUSTOMER_PASSWORD") or DEFAULT_CUSTOMER_PASSWORD,
        )
        parser.add_argument("--orders", type=int, default=48, help="Orders to generate.")
        parser.add_argument("--seed", type=int, default=7, help="Random seed (deterministic).")

    def handle(self, *args: Any, **options: Any) -> None:
        rng = random.Random(options["seed"])
        with transaction.atomic():
            products = self._catalog()
            admin = self._user(
                options["admin_email"], "Store Admin", Role.ADMIN, options["admin_password"]
            )
            customers = [
                self._user(email, name, Role.CUSTOMER, options["customer_password"])
                for email, name in DEMO_CUSTOMERS
            ]

        if Order.objects.exists():
            self.stdout.write("Orders already exist; skipping order history.")
        else:
            self._orders(rng, customers, products, admin, options["orders"])
            # Reset stock to the curated values so the storefront shows realistic
            # in-stock / low-stock / sold-out states regardless of generated history.
            for spec in PRODUCTS:
                Product.objects.filter(sku=spec["sku"]).update(stock=spec["stock"])

        self.stdout.write(
            self.style.SUCCESS(
                f"Demo data ready: {Product.objects.count()} products, "
                f"{User.objects.count()} users, {Order.objects.count()} orders.\n"
                f"  admin:    {options['admin_email']}\n"
                f"  customer: {DEMO_CUSTOMERS[0][0]}"
            )
        )

    def _catalog(self) -> list[Product]:
        categories = {}
        for name, slug, description in CATEGORIES:
            categories[slug], _ = Category.objects.update_or_create(
                slug=slug, defaults={"name": name, "description": description}
            )
        products = []
        for spec in PRODUCTS:
            slug = slugify(spec["name"])
            product, _ = Product.objects.get_or_create(
                sku=spec["sku"],
                defaults={
                    "name": spec["name"],
                    "slug": slug,
                    "category": categories[spec["category"]],
                    "price": spec["price"],
                    "stock": 500,
                    "description": spec["description"],
                    "image_url": f"/products/{slug}.svg",
                    "is_featured": spec["featured"],
                },
            )
            products.append(product)
        return products

    def _user(self, email: str, name: str, role: str, password: str) -> User:
        user = User.objects.filter(email=email).first()
        if user is None:
            user = User.objects.create_user(
                email=email, password=password, full_name=name, role=role
            )
        return user

    def _orders(
        self,
        rng: random.Random,
        customers: list[User],
        products: list[Product],
        admin: User,
        count: int,
    ) -> None:
        now = timezone.now()
        weights = [3 if p.is_featured else 1 for p in products]
        for index in range(count):
            customer = rng.choice(customers)
            cart, _ = Cart.objects.get_or_create(user=customer)
            CartItem.objects.filter(cart=cart).delete()
            for product in set(rng.choices(products, weights=weights, k=rng.randint(1, 3))):
                CartItem.objects.create(cart=cart, product=product, quantity=rng.randint(1, 2))

            city, postal, country = rng.choice(CITIES)
            declined = index % 11 == 5
            try:
                result = checkout.place_order(
                    customer,
                    address=checkout.ShippingAddress(
                        name=customer.full_name,
                        line1=f"{rng.randint(10, 999)} Market Street",
                        city=city,
                        postal_code=postal,
                        country=country,
                    ),
                    payment_token=DECLINE_TOKEN if declined else APPROVE_TOKEN,
                    idempotency_key=uuid.uuid4().hex,
                )
                order = result.order
            except checkout.PaymentDeclined as exc:
                order = exc.order

            age = timedelta(days=rng.uniform(0, 29.5), minutes=rng.randint(0, 600))
            placed = now - age
            if order.status == OrderStatus.PAID:
                days_old = age.days
                if days_old > 6:
                    order = state.transition(order, OrderStatus.SHIPPED, actor=admin)
                    order = state.transition(order, OrderStatus.DELIVERED, actor=admin)
                elif days_old > 2:
                    order = state.transition(order, OrderStatus.SHIPPED, actor=admin)
                elif index % 9 == 0:
                    order = state.transition(
                        order, OrderStatus.CANCELLED, actor=customer, note="Cancelled by customer"
                    )
            self._backdate(order, placed)
            CartItem.objects.filter(cart=cart).delete()

    def _backdate(self, order: Order, placed: Any) -> None:
        stamps: dict[str, Any] = {"created_at": placed}
        offsets = {
            "paid_at": timedelta(minutes=1),
            "shipped_at": timedelta(days=1, hours=3),
            "delivered_at": timedelta(days=4),
            "cancelled_at": timedelta(hours=5),
        }
        for field, offset in offsets.items():
            if getattr(order, field) is not None:
                stamps[field] = placed + offset
        Order.objects.filter(pk=order.pk).update(**stamps)
        for i, event in enumerate(order.events.all()):
            fixed: dict[str, Any] = {
                OrderStatus.PENDING_PAYMENT.value: placed,
                OrderStatus.PAYMENT_FAILED.value: placed + timedelta(minutes=1),
            }
            ts = fixed.get(event.to_status) or stamps.get(f"{event.to_status}_at", placed)
            OrderEvent.objects.filter(pk=event.pk).update(created_at=ts + timedelta(seconds=i))
