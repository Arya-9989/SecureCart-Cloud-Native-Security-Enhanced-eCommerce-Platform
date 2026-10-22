from __future__ import annotations

import re
from typing import Any, cast

import django_filters
from django.conf import settings
from django.db.models import Count, Prefetch, QuerySet
from django.http import HttpResponse
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    extend_schema_view,
)
from rest_framework import filters, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.permissions import IsAdminRole
from apps.accounts.throttles import CheckoutRateThrottle
from apps.audit import services as audit
from apps.core.exceptions import Conflict
from apps.orders import checkout, invoice, state
from apps.orders.models import Order, OrderItem, OrderStatus
from apps.orders.serializers import (
    AdminOrderSerializer,
    CheckoutSerializer,
    OrderSerializer,
    OrderSummarySerializer,
    TransitionSerializer,
)

_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9\-_]{8,64}$")


def _error(code: str, message: str, http_status: int, **extra: Any) -> Response:
    return Response({"error": {"code": code, "message": message, **extra}}, status=http_status)


def _detail_queryset() -> QuerySet[Order]:
    return Order.objects.select_related("user").prefetch_related("items", "events")


_INVOICE_SCHEMA = extend_schema(
    responses={
        (200, "application/pdf"): OpenApiTypes.BINARY,
        409: OpenApiResponse(description="The order was never paid"),
    },
    summary="Download the order's invoice (PDF)",
)


def _invoice_response(order: Order) -> HttpResponse:
    try:
        pdf = invoice.render(order)
    except invoice.InvoiceUnavailable as exc:
        raise Conflict("Invoices are issued once an order is paid.") from exc
    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{invoice.filename(order)}"'
    response["Content-Length"] = str(len(pdf))
    return response


class CheckoutView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [CheckoutRateThrottle]

    @extend_schema(
        request=CheckoutSerializer,
        parameters=[
            OpenApiParameter(
                "Idempotency-Key",
                OpenApiTypes.STR,
                OpenApiParameter.HEADER,
                required=True,
                description="Unique per checkout attempt (8-64 chars). Retries with the same "
                "key return the original order instead of charging twice.",
            )
        ],
        responses={
            201: OrderSerializer,
            200: OpenApiResponse(OrderSerializer, description="Idempotent replay"),
            202: OpenApiResponse(
                OrderSerializer,
                description="Payment started; the provider confirms it by webhook "
                "(order stays pending_payment until then)",
            ),
            402: OpenApiResponse(
                description="Payment declined; stock released (also returned when replaying "
                "a declined attempt's key)"
            ),
            403: OpenApiResponse(description="Email address not confirmed yet"),
            409: OpenApiResponse(description="Insufficient stock or empty cart"),
        },
        tags=["orders"],
        summary="Place an order from the current cart",
    )
    def post(self, request: Request) -> Response:
        user = cast(User, request.user)
        if settings.REQUIRE_VERIFIED_EMAIL and not user.email_verified:
            return _error(
                "email_unverified",
                "Confirm your email address to place an order. We sent you a link.",
                status.HTTP_403_FORBIDDEN,
            )
        key = request.headers.get("Idempotency-Key", "")
        if not _IDEMPOTENCY_KEY_RE.match(key):
            raise ValidationError(
                {"idempotency_key": "Send an Idempotency-Key header (8-64 URL-safe characters)."}
            )
        serializer = CheckoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            result = checkout.place_order(
                user,
                address=checkout.ShippingAddress(**data["shipping_address"]),
                payment_token=data["payment_token"],
                idempotency_key=key,
            )
        except checkout.PaymentDeclined as exc:
            return _error(
                exc.code, exc.message, status.HTTP_402_PAYMENT_REQUIRED, order_id=str(exc.order.pk)
            )
        except checkout.CheckoutError as exc:
            return _error(exc.code, exc.message, status.HTTP_409_CONFLICT, items=exc.details)

        if result.replayed and result.order.status == OrderStatus.PAYMENT_FAILED:
            # A retry of a declined attempt gets the answer the first attempt got.
            return _error(
                checkout.PaymentDeclined.code,
                result.order.failure_reason or "Payment was declined.",
                status.HTTP_402_PAYMENT_REQUIRED,
                order_id=str(result.order.pk),
            )
        order = _detail_queryset().get(pk=result.order.pk)
        if order.status == OrderStatus.PENDING_PAYMENT:
            # The provider confirms asynchronously (webhook): accepted, not yet paid.
            code: int = status.HTTP_202_ACCEPTED
        else:
            code = status.HTTP_200_OK if result.replayed else status.HTTP_201_CREATED
        return Response(OrderSerializer(order).data, status=code)


class OrderFilter(django_filters.FilterSet):
    status = django_filters.MultipleChoiceFilter(choices=OrderStatus.choices)
    created_after = django_filters.IsoDateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_before = django_filters.IsoDateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = Order
        fields = ["status", "created_after", "created_before"]


@extend_schema_view(
    list=extend_schema(tags=["orders"], summary="The current user's order history"),
    retrieve=extend_schema(tags=["orders"], summary="One of the current user's orders"),
)
class OrderViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet[Order]
):
    """Customers only ever see their own orders: other users' orders return 404."""

    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_class = OrderFilter

    def get_queryset(self) -> QuerySet[Order]:
        if getattr(self, "swagger_fake_view", False):  # schema generation only
            return Order.objects.none()
        queryset = Order.objects.filter(user=cast(User, self.request.user))
        if self.action == "list":
            # Explicit order_by: Meta.ordering is not applied to GROUP BY (annotated) queries.
            return (
                queryset.annotate(item_count=Count("items"))
                .prefetch_related(
                    Prefetch("items", queryset=OrderItem.objects.only("order_id", "image_url"))
                )
                .order_by("-created_at")
            )
        return queryset.prefetch_related("items", "events")

    def get_serializer_class(self) -> type[BaseSerializer[Order]]:
        return OrderSummarySerializer if self.action == "list" else OrderSerializer

    @extend_schema(tags=["orders"])
    @_INVOICE_SCHEMA
    @action(detail=True, methods=["get"])
    def invoice(self, request: Request, pk: str | None = None) -> HttpResponse:
        # get_object() goes through get_queryset(): another customer's order is a 404.
        return _invoice_response(self.get_object())

    @extend_schema(
        request=None,
        responses={200: OrderSerializer, 409: OpenApiResponse(description="Not cancellable")},
        tags=["orders"],
        summary="Cancel an order that has not shipped (restocks and refunds)",
    )
    @action(detail=True, methods=["post"])
    def cancel(self, request: Request, pk: str | None = None) -> Response:
        order = self.get_object()
        try:
            order = state.transition(
                order, OrderStatus.CANCELLED, actor=request.user, note="Cancelled by customer"
            )
        except state.InvalidTransition as exc:
            raise Conflict(f"Orders that are '{exc.current}' can no longer be cancelled.") from exc
        return Response(OrderSerializer(_detail_queryset().get(pk=order.pk)).data)


@extend_schema_view(
    list=extend_schema(tags=["admin"], summary="Monitor all orders"),
    retrieve=extend_schema(tags=["admin"], summary="Order detail with customer and payment"),
)
class AdminOrderViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet[Order]
):
    serializer_class = AdminOrderSerializer
    permission_classes = [IsAdminRole]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = OrderFilter
    search_fields = ["number", "user__email", "user__full_name", "shipping_name"]
    ordering_fields = ["created_at", "total", "status"]
    ordering = ["-created_at"]

    def get_queryset(self) -> QuerySet[Order]:
        return _detail_queryset()

    @extend_schema(tags=["admin"])
    @_INVOICE_SCHEMA
    @action(detail=True, methods=["get"], url_path="invoice")
    def invoice(self, request: Request, pk: str | None = None) -> HttpResponse:
        return _invoice_response(self.get_object())

    @extend_schema(
        request=TransitionSerializer,
        responses={200: AdminOrderSerializer, 409: OpenApiResponse(description="Invalid move")},
        tags=["admin"],
        summary="Advance an order (ship, deliver or cancel)",
    )
    @action(detail=True, methods=["post"])
    def transition(self, request: Request, pk: str | None = None) -> Response:
        order = self.get_object()
        serializer = TransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target = serializer.validated_data["status"]
        previous = order.status
        try:
            order = state.transition(
                order, target, actor=request.user, note=serializer.validated_data["note"]
            )
        except state.InvalidTransition as exc:
            raise Conflict(str(exc)) from exc
        audit.record(
            "admin.order.status_changed",
            request=request,
            target=order,
            changes={"status": [previous, target]},
        )
        return Response(AdminOrderSerializer(_detail_queryset().get(pk=order.pk)).data)
