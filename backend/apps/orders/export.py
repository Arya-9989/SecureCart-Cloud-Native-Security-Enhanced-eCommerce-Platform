"""CSV export of orders for administrators (bookkeeping, fulfilment, reporting).

Cells that a spreadsheet would treat as a formula (starting with ``=``, ``+``, ``-``,
``@``, a tab or a carriage return) are prefixed with an apostrophe, per OWASP's CSV
injection guidance. Customer-controlled fields such as names and addresses can therefore
never run as formulas when the file is opened in Excel, Sheets or Numbers. Rows are
streamed, so a large export never sits in memory.
"""

from __future__ import annotations

import csv
from collections.abc import Iterable, Iterator
from datetime import datetime
from typing import Any

from django.db.models import Count, QuerySet

from apps.orders.models import Order

HEADER = [
    "number", "placed_at", "status", "customer_email", "customer_name", "items", "currency",
    "subtotal", "shipping", "tax", "total", "paid_at", "shipped_at", "delivered_at",
    "cancelled_at", "payment_provider", "payment_reference", "ship_to_name", "ship_to_city",
    "ship_to_country",
]  # fmt: skip

_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    text = str(value)
    return f"'{text}" if text.startswith(_FORMULA_PREFIXES) else text


class _Echo:
    def write(self, value: str) -> str:
        return value


def rows(orders: QuerySet[Order]) -> Iterator[list[str]]:
    annotated = orders.select_related("user").annotate(item_count=Count("items"))
    for order in annotated.iterator(chunk_size=500):
        yield [
            safe_cell(v)
            for v in (
                order.number,
                order.created_at,
                order.status,
                order.user.email,
                order.user.full_name,
                order.item_count,
                order.currency,
                order.subtotal,
                order.shipping,
                order.tax,
                order.total,
                order.paid_at,
                order.shipped_at,
                order.delivered_at,
                order.cancelled_at,
                order.payment_provider,
                order.payment_reference,
                order.shipping_name,
                order.shipping_city,
                order.shipping_country,
            )
        ]


def stream(data_rows: Iterable[list[str]]) -> Iterator[str]:
    writer = csv.writer(_Echo())
    yield "\ufeff"  # BOM: Excel otherwise misreads UTF-8 names
    yield writer.writerow(HEADER)
    for row in data_rows:
        yield writer.writerow(row)
