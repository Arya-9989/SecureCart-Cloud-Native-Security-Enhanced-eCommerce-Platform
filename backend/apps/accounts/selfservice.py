"""Account self-service: sign out everywhere, export my data, delete my account.

Deletion is an anonymisation, not a row delete. Orders are financial records that must be
kept (and they reference the user with ``on_delete=PROTECT``), so the account is detached
from the person instead:

- the email becomes ``deleted-<random>@deleted.invalid`` and the name "Deleted account";
- the password is made unusable and the account deactivated;
- every session is revoked; the bag, one-time tokens and outstanding refresh tokens are
  removed.

Orders keep their line items, totals and shipping snapshot for accounting. The audit log
keeps its security records. Both are documented retention, not an oversight.
"""

from __future__ import annotations

import uuid
from typing import Any

from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from apps.accounts import tokens
from apps.accounts.models import OneTimeToken, Role, User
from apps.audit.models import AuditLog
from apps.cart.models import Cart
from apps.orders.models import Order, OrderStatus

#: Orders in these states still need the customer (delivery, refunds): no deletion yet.
OPEN_ORDER_STATUSES = (OrderStatus.PENDING_PAYMENT, OrderStatus.PAID, OrderStatus.SHIPPED)


class DeletionRefused(Exception):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def export(user: User) -> dict[str, Any]:
    """Everything SecureCart holds about ``user``, as JSON-safe data."""
    orders = (
        Order.objects.filter(user=user).prefetch_related("items", "events").order_by("created_at")
    )
    cart = Cart.objects.filter(user=user).prefetch_related("items__product").first()
    events = AuditLog.objects.filter(actor=user).order_by("created_at")
    return {
        "exported_at": timezone.now().isoformat(),
        "profile": {
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role,
            "email_verified": user.email_verified,
            "date_joined": user.date_joined.isoformat(),
            "last_login": user.last_login.isoformat() if user.last_login else None,
        },
        "orders": [
            {
                "number": order.number,
                "status": order.status,
                "currency": order.currency,
                "subtotal": str(order.subtotal),
                "shipping": str(order.shipping),
                "tax": str(order.tax),
                "total": str(order.total),
                "placed_at": order.created_at.isoformat(),
                "shipping_address": {
                    "name": order.shipping_name,
                    "line1": order.shipping_line1,
                    "line2": order.shipping_line2,
                    "city": order.shipping_city,
                    "postal_code": order.shipping_postal_code,
                    "country": order.shipping_country,
                },
                "items": [
                    {
                        "name": item.product_name,
                        "sku": item.sku,
                        "unit_price": str(item.unit_price),
                        "quantity": item.quantity,
                        "line_total": str(item.line_total),
                    }
                    for item in order.items.all()
                ],
                "history": [
                    {"status": e.to_status, "at": e.created_at.isoformat(), "note": e.note}
                    for e in order.events.all()
                ],
            }
            for order in orders
        ],
        "bag": [
            {"sku": item.product.sku, "name": item.product.name, "quantity": item.quantity}
            for item in (cart.items.all() if cart else [])
        ],
        "account_activity": [
            {
                "action": e.action,
                "at": e.created_at.isoformat(),
                "ip_address": e.ip_address,
                "user_agent": e.user_agent,
            }
            for e in events
        ],
    }


def delete(user: User) -> None:
    """Anonymise ``user`` (see the module docstring). Raises ``DeletionRefused``."""
    if user.role == Role.ADMIN:
        raise DeletionRefused(
            "Administrator accounts can't be deleted from here. Ask another administrator "
            "to remove the admin role first.",
            "admin_account",
        )
    if Order.objects.filter(user=user, status__in=OPEN_ORDER_STATUSES).exists():
        raise DeletionRefused(
            "You have orders that are still open. Cancel them, or wait until they are "
            "delivered, then delete your account.",
            "open_orders",
        )
    with transaction.atomic():
        tokens.revoke_all(user)
        OutstandingToken.objects.filter(user=user).delete()
        OneTimeToken.objects.filter(user=user).delete()
        Cart.objects.filter(user=user).delete()
        user.email = f"deleted-{uuid.uuid4().hex}@deleted.invalid"
        user.full_name = "Deleted account"
        user.is_active = False
        user.email_verified_at = None
        user.set_unusable_password()
        user.save(
            update_fields=["email", "full_name", "is_active", "email_verified_at", "password"]
        )
