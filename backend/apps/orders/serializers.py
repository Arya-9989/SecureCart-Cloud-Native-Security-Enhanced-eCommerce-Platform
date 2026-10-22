from __future__ import annotations

from rest_framework import serializers

from apps.orders.models import Order, OrderEvent, OrderItem
from apps.orders.state import ADMIN_ALLOWED, CUSTOMER_ALLOWED, TRANSITIONS


class OrderItemSerializer(serializers.ModelSerializer[OrderItem]):
    class Meta:
        model = OrderItem
        fields = [
            "id",
            "product_id",
            "product_name",
            "sku",
            "image_url",
            "unit_price",
            "quantity",
            "line_total",
        ]
        read_only_fields = fields


class OrderEventSerializer(serializers.ModelSerializer[OrderEvent]):
    class Meta:
        model = OrderEvent
        fields = ["from_status", "to_status", "note", "created_at"]
        read_only_fields = fields


class ShippingAddressSerializer(serializers.Serializer[None]):
    name = serializers.CharField(max_length=120, min_length=2)
    line1 = serializers.CharField(max_length=200, min_length=3)
    line2 = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    city = serializers.CharField(max_length=100, min_length=2)
    postal_code = serializers.RegexField(r"^[A-Za-z0-9 \-]{3,10}$", max_length=10)
    country = serializers.RegexField(
        r"^[A-Za-z]{2}$", max_length=2, error_messages={"invalid": "Use a 2-letter country code."}
    )

    def validate_country(self, value: str) -> str:
        return value.upper()


class OrderSerializer(serializers.ModelSerializer[Order]):
    items = OrderItemSerializer(many=True, read_only=True)
    events = OrderEventSerializer(many=True, read_only=True)
    shipping_address = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id",
            "number",
            "status",
            "currency",
            "subtotal",
            "shipping",
            "tax",
            "total",
            "shipping_address",
            "payment_provider",
            "failure_reason",
            "items",
            "events",
            "can_cancel",
            "created_at",
            "paid_at",
            "shipped_at",
            "delivered_at",
            "cancelled_at",
        ]
        read_only_fields = fields

    def get_shipping_address(self, order: Order) -> dict[str, str]:
        return {
            "name": order.shipping_name,
            "line1": order.shipping_line1,
            "line2": order.shipping_line2,
            "city": order.shipping_city,
            "postal_code": order.shipping_postal_code,
            "country": order.shipping_country,
        }

    def get_can_cancel(self, order: Order) -> bool:
        return bool(CUSTOMER_ALLOWED & TRANSITIONS[order.status])


class OrderSummarySerializer(serializers.ModelSerializer[Order]):
    item_count = serializers.IntegerField(read_only=True)
    preview_images = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id",
            "number",
            "status",
            "currency",
            "total",
            "item_count",
            "preview_images",
            "created_at",
        ]
        read_only_fields = fields

    def get_preview_images(self, order: Order) -> list[str]:
        return [item.image_url for item in order.items.all()][:4]


class AdminOrderSerializer(OrderSerializer):
    customer_email = serializers.EmailField(source="user.email", read_only=True)
    customer_name = serializers.CharField(source="user.full_name", read_only=True)
    payment_reference = serializers.CharField(read_only=True)
    allowed_transitions = serializers.SerializerMethodField()

    class Meta(OrderSerializer.Meta):
        fields = [
            *OrderSerializer.Meta.fields,
            "customer_email",
            "customer_name",
            "payment_reference",
            "allowed_transitions",
        ]
        read_only_fields = fields

    def get_allowed_transitions(self, order: Order) -> list[str]:
        return sorted(ADMIN_ALLOWED & TRANSITIONS[order.status])


class CheckoutSerializer(serializers.Serializer[None]):
    shipping_address = ShippingAddressSerializer()
    payment_token = serializers.CharField(max_length=128)


class TransitionSerializer(serializers.Serializer[None]):
    status = serializers.ChoiceField(choices=sorted(ADMIN_ALLOWED))
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
