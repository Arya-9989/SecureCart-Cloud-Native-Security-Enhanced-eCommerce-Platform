from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.conf import settings
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.cart.models import Cart, CartItem
from apps.catalog.models import Product
from apps.orders.pricing import compute_totals, money


class CartProductSerializer(serializers.ModelSerializer[Product]):
    class Meta:
        model = Product
        fields = ["id", "name", "slug", "sku", "price", "stock", "image_url", "is_active"]
        read_only_fields = fields


class CartItemSerializer(serializers.ModelSerializer[CartItem]):
    product = CartProductSerializer(read_only=True)
    line_total = serializers.SerializerMethodField()
    is_available = serializers.SerializerMethodField()

    class Meta:
        model = CartItem
        fields = ["id", "product", "quantity", "line_total", "is_available"]
        read_only_fields = fields

    @extend_schema_field(OpenApiTypes.DECIMAL)
    def get_line_total(self, item: CartItem) -> str:
        return str(money(item.product.price * item.quantity))

    def get_is_available(self, item: CartItem) -> bool:
        return item.product.is_active and item.product.stock >= item.quantity


class CartSerializer(serializers.ModelSerializer[Cart]):
    items = CartItemSerializer(many=True, read_only=True)
    item_count = serializers.SerializerMethodField()
    subtotal = serializers.SerializerMethodField()
    shipping = serializers.SerializerMethodField()
    tax = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()
    currency = serializers.SerializerMethodField()

    class Meta:
        model = Cart
        fields = [
            "items",
            "item_count",
            "subtotal",
            "shipping",
            "tax",
            "total",
            "currency",
            "updated_at",
        ]
        read_only_fields = fields

    def _totals(self, cart: Cart) -> Any:
        cache = self.context.setdefault("_totals", {})
        if cart.pk not in cache:
            subtotal = sum((i.product.price * i.quantity for i in cart.items.all()), Decimal("0"))
            cache[cart.pk] = compute_totals(subtotal)
        return cache[cart.pk]

    def get_item_count(self, cart: Cart) -> int:
        return sum(i.quantity for i in cart.items.all())

    @extend_schema_field(OpenApiTypes.DECIMAL)
    def get_subtotal(self, cart: Cart) -> str:
        return str(self._totals(cart).subtotal)

    @extend_schema_field(OpenApiTypes.DECIMAL)
    def get_shipping(self, cart: Cart) -> str:
        return str(self._totals(cart).shipping)

    @extend_schema_field(OpenApiTypes.DECIMAL)
    def get_tax(self, cart: Cart) -> str:
        return str(self._totals(cart).tax)

    @extend_schema_field(OpenApiTypes.DECIMAL)
    def get_total(self, cart: Cart) -> str:
        return str(self._totals(cart).total)

    def get_currency(self, cart: Cart) -> str:
        return str(settings.STORE_CURRENCY)


class AddCartItemSerializer(serializers.Serializer[None]):
    product_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1, default=1)

    def validate_quantity(self, value: int) -> int:
        if value > settings.MAX_CART_LINE_QUANTITY:
            raise serializers.ValidationError(
                f"You can add at most {settings.MAX_CART_LINE_QUANTITY} of an item."
            )
        return value


class UpdateCartItemSerializer(serializers.Serializer[None]):
    quantity = serializers.IntegerField(min_value=1)

    def validate_quantity(self, value: int) -> int:
        return AddCartItemSerializer().validate_quantity(value)
