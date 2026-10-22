"""Converting store amounts (Decimal, major units) to the integer minor units gateways expect."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

# ISO 4217 currencies Stripe treats as having no minor unit.
ZERO_DECIMAL = frozenset(
    {
        "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND",
        "VUV", "XAF", "XOF", "XPF",
    }
)  # fmt: skip


def to_minor_units(amount: Decimal, currency: str) -> int:
    """``Decimal("53.99"), "USD"`` -> ``5399``; ``Decimal("1200"), "JPY"`` -> ``1200``."""
    if amount < 0:
        raise ValueError("Amounts are never negative.")
    exponent = 0 if currency.upper() in ZERO_DECIMAL else 2
    scaled = (amount * (10**exponent)).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    return int(scaled)
