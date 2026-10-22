"""Server-side invoice PDFs, rendered from the order's own snapshot.

Everything printed comes from the order row and its line items as they were captured at
checkout (names, SKUs, unit prices, totals, tax rate, currency). Catalog edits made later
never change an invoice, and nothing is recomputed from current prices.

Money uses CLDR formatting through Babel with the en-US locale, the same rules as the
storefront's ``Intl.NumberFormat("en-US")``: ``$1,234.50``, ``€1,234.50`` and ``¥1,235``
(no minor unit for JPY). The PDF uses the standard Helvetica face, so nothing is embedded
or fetched. Its encoding covers ``$ € £ ¥``. A currency whose symbol it cannot draw (for
example ``₹``) is printed with its ISO code instead (``INR 1,234.50``), never as a missing
glyph.
"""

from __future__ import annotations

import io
from decimal import Decimal

from babel.numbers import format_currency, format_percent
from django.conf import settings
from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from apps.orders.models import Order, OrderStatus

INK = colors.HexColor("#1d1d1f")
MUTED = colors.HexColor("#6e6e73")
LINE = colors.HexColor("#d2d2d7")
ACCENT = colors.HexColor("#0b4fd1")


_PROVIDER_NAMES = {"mock": "the mock payment provider", "stripe": "Stripe"}


class InvoiceUnavailable(Exception):
    """The order was never paid, so there is nothing to invoice."""


def money(amount: Decimal, currency: str) -> str:
    text = format_currency(amount, currency, locale="en_US")
    try:
        text.encode("cp1252")  # the standard PDF fonts' WinAnsi encoding
    except UnicodeEncodeError:
        text = format_currency(
            amount, currency, format="¤¤\u00a0#,##0.00", locale="en_US", currency_digits=True
        )
    return text


def is_invoiceable(order: Order) -> bool:
    return order.paid_at is not None


def filename(order: Order) -> str:
    return f"invoice-{order.number}.pdf"


def _styles() -> dict[str, ParagraphStyle]:
    base = ParagraphStyle("base", fontName="Helvetica", fontSize=9.5, leading=13, textColor=INK)
    return {
        "base": base,
        "muted": ParagraphStyle("muted", parent=base, textColor=MUTED),
        "brand": ParagraphStyle("brand", parent=base, fontName="Helvetica-Bold", fontSize=13),
        "title": ParagraphStyle(
            "title",
            parent=base,
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=26,
            alignment=TA_RIGHT,
        ),
        "right": ParagraphStyle("right", parent=base, alignment=TA_RIGHT),
        "right_muted": ParagraphStyle(
            "right_muted", parent=base, alignment=TA_RIGHT, textColor=MUTED
        ),
    }


def _escape(text: str) -> str:
    # Paragraph parses a small markup language: customer-controlled text must stay text.
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render(order: Order) -> bytes:
    """Return the invoice PDF for a paid order (raises ``InvoiceUnavailable`` otherwise)."""
    if not is_invoiceable(order):
        raise InvoiceUnavailable(order.number)
    styles = _styles()
    cur = order.currency
    paid_at = timezone.localtime(order.paid_at)
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"Invoice {order.number}",
        author=settings.STORE_NAME,
        subject=f"Invoice for order {order.number}",
        creator="SecureCart",
    )
    # The frame pads 6 pt on each side; full-width tables use what is left, so every block
    # shares one left edge.
    width = doc.width - 12

    header = Table(
        [
            [
                Paragraph(_escape(settings.STORE_NAME), styles["brand"]),
                Paragraph("Invoice", styles["title"]),
            ],
            [
                Paragraph(_escape(settings.STORE_ADDRESS).replace("\n", "<br/>"), styles["muted"]),
                Paragraph(
                    f"Invoice no. {order.number}<br/>"
                    f"Issued {paid_at:%d %b %Y}<br/>"
                    f"Order placed {timezone.localtime(order.created_at):%d %b %Y}",
                    styles["right_muted"],
                ),
            ],
        ],
        colWidths=[width * 0.55, width * 0.45],
    )
    header.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )

    address_lines = [
        order.shipping_name,
        order.shipping_line1,
        order.shipping_line2,
        f"{order.shipping_city} {order.shipping_postal_code}",
        order.shipping_country,
    ]
    bill_to = Paragraph(
        "<b>Billed and shipped to</b><br/>"
        + "<br/>".join(_escape(line) for line in address_lines if line)
        + f"<br/>{_escape(order.user.email)}",
        styles["base"],
    )

    rows: list[list[object]] = [
        [
            Paragraph("<b>Item</b>", styles["base"]),
            Paragraph("<b>SKU</b>", styles["base"]),
            Paragraph("<b>Qty</b>", styles["right"]),
            Paragraph("<b>Unit price</b>", styles["right"]),
            Paragraph("<b>Amount</b>", styles["right"]),
        ]
    ]
    for item in order.items.all():
        rows.append(
            [
                Paragraph(_escape(item.product_name), styles["base"]),
                Paragraph(_escape(item.sku), styles["muted"]),
                Paragraph(str(item.quantity), styles["right"]),
                Paragraph(money(item.unit_price, cur), styles["right"]),
                Paragraph(money(item.line_total, cur), styles["right"]),
            ]
        )
    lines = Table(
        rows, colWidths=[width * 0.38, width * 0.18, width * 0.1, width * 0.17, width * 0.17]
    )
    lines.setStyle(
        TableStyle(
            [
                ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK),
                ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )

    tax_label = "Tax"
    if order.tax_rate is not None:
        tax_label = f"Tax ({format_percent(order.tax_rate, locale='en_US', format='#,##0.##%')})"
    bold = ParagraphStyle(
        "bold_right", parent=styles["right"], fontName="Helvetica-Bold", fontSize=11, leading=15
    )
    totals_rows = [
        ("Subtotal", money(order.subtotal, cur)),
        ("Shipping", money(order.shipping, cur) if order.shipping else "Free"),
        (tax_label, money(order.tax, cur)),
    ]
    totals = Table(
        [
            [Paragraph(a, styles["right_muted"]), Paragraph(b, styles["right"])]
            for a, b in totals_rows
        ]
        + [[Paragraph("Total", bold), Paragraph(money(order.total, cur), bold)]],
        colWidths=[width * 0.25, width * 0.2],
        hAlign="RIGHT",
    )
    totals.setStyle(
        TableStyle(
            [
                ("LINEABOVE", (0, -1), (-1, -1), 0.8, INK),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )

    provider = _PROVIDER_NAMES.get(order.payment_provider, order.payment_provider)
    payment_note = f"Paid {paid_at:%d %b %Y %H:%M %Z} via {_escape(provider)}."
    if order.payment_reference:
        payment_note += f" Reference {_escape(order.payment_reference)}."
    if order.status == OrderStatus.CANCELLED and order.cancelled_at:
        payment_note += (
            f" Order cancelled {timezone.localtime(order.cancelled_at):%d %b %Y}; "
            "the payment was refunded."
        )

    story = [
        header,
        Spacer(1, 12 * mm),
        bill_to,
        Spacer(1, 8 * mm),
        lines,
        Spacer(1, 6 * mm),
        totals,
        Spacer(1, 10 * mm),
        Paragraph(payment_note, styles["muted"]),
        Spacer(1, 3 * mm),
        Paragraph(
            f"Amounts in {cur}. {_escape(settings.INVOICE_FOOTER)}",
            styles["muted"],
        ),
    ]
    doc.build(story)
    return buffer.getvalue()
