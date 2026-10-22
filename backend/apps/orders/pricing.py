"""Single source of truth for money math, shared by the cart preview and checkout."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings

CENT = Decimal("0.01")


def money(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Totals:
    subtotal: Decimal
    shipping: Decimal
    tax: Decimal
    total: Decimal


def compute_totals(subtotal: Decimal) -> Totals:
    subtotal = money(subtotal)
    if subtotal == 0:
        return Totals(subtotal, money(0), money(0), money(0))
    threshold = Decimal(settings.FREE_SHIPPING_THRESHOLD)
    shipping = money(0) if subtotal >= threshold else money(settings.FLAT_SHIPPING_FEE)
    tax = money(subtotal * Decimal(settings.TAX_RATE))
    return Totals(subtotal, shipping, tax, money(subtotal + shipping + tax))
