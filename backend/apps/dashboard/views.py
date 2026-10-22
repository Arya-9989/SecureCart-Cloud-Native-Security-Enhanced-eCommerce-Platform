from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db.models import Avg, Count, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role, User
from apps.accounts.permissions import IsAdminRole
from apps.catalog.models import Product
from apps.orders.models import Order, OrderItem, OrderStatus
from apps.orders.pricing import money

#: Orders whose money has been captured and not refunded.
REVENUE_STATUSES = [OrderStatus.PAID, OrderStatus.SHIPPED, OrderStatus.DELIVERED]
LOW_STOCK_THRESHOLD = 5

_DashboardSerializer = inline_serializer(
    "DashboardStats",
    {
        "currency": serializers.CharField(),
        "revenue_total": serializers.DecimalField(max_digits=14, decimal_places=2),
        "revenue_30d": serializers.DecimalField(max_digits=14, decimal_places=2),
        "average_order_value": serializers.DecimalField(max_digits=14, decimal_places=2),
        "orders_total": serializers.IntegerField(),
        "orders_by_status": serializers.DictField(child=serializers.IntegerField()),
        "customers_total": serializers.IntegerField(),
        "products_active": serializers.IntegerField(),
        "revenue_by_day": serializers.ListField(child=serializers.DictField()),
        "top_products": serializers.ListField(child=serializers.DictField()),
        "low_stock": serializers.ListField(child=serializers.DictField()),
    },
)


class DashboardView(APIView):
    permission_classes = [IsAdminRole]

    @extend_schema(responses=_DashboardSerializer, tags=["admin"], summary="Store KPIs")
    def get(self, request: Request) -> Response:
        today = timezone.localdate()
        start = today - timedelta(days=29)
        revenue_orders = Order.objects.filter(status__in=REVENUE_STATUSES)

        aggregates = revenue_orders.aggregate(revenue=Sum("total"), aov=Avg("total"))
        daily = {
            row["day"]: row
            for row in revenue_orders.filter(paid_at__date__gte=start)
            .annotate(day=TruncDate("paid_at"))
            .values("day")
            .annotate(revenue=Sum("total"), orders=Count("id"))
        }
        revenue_by_day = []
        for offset in range(30):
            day = start + timedelta(days=offset)
            row = daily.get(day)
            revenue_by_day.append(
                {
                    "date": day.isoformat(),
                    "revenue": str(money(row["revenue"] if row else 0)),
                    "orders": row["orders"] if row else 0,
                }
            )
        revenue_30d = sum((Decimal(d["revenue"]) for d in revenue_by_day), Decimal("0"))

        by_status = dict.fromkeys(OrderStatus.values, 0)
        for row in Order.objects.values("status").annotate(n=Count("id")):
            by_status[row["status"]] = row["n"]

        top_products = list(
            OrderItem.objects.filter(order__status__in=REVENUE_STATUSES)
            .values("product_id", "product_name")
            .annotate(units=Sum("quantity"), revenue=Sum("line_total"))
            .order_by("-units", "-revenue")[:5]
        )
        low_stock = list(
            Product.objects.filter(is_active=True, stock__lte=LOW_STOCK_THRESHOLD)
            .order_by("stock", "name")
            .values("id", "name", "sku", "stock")[:8]
        )

        return Response(
            {
                "currency": settings.STORE_CURRENCY,
                "revenue_total": str(money(aggregates["revenue"] or 0)),
                "revenue_30d": str(money(revenue_30d)),
                "average_order_value": str(money(aggregates["aov"] or 0)),
                "orders_total": sum(by_status.values()),
                "orders_by_status": by_status,
                "customers_total": User.objects.filter(role=Role.CUSTOMER).count(),
                "products_active": Product.objects.filter(is_active=True).count(),
                "revenue_by_day": revenue_by_day,
                "top_products": [
                    {**p, "revenue": str(money(p["revenue"])), "units": int(p["units"])}
                    for p in top_products
                ],
                "low_stock": low_stock,
            }
        )
