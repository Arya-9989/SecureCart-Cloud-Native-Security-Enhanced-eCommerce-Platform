from __future__ import annotations

from typing import Any

from django.core.validators import RegexValidator
from django.utils.text import slugify
from rest_framework import serializers
from rest_framework.validators import UniqueValidator

from apps.catalog.models import Category, Product


class CategorySerializer(serializers.ModelSerializer[Category]):
    product_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Category
        fields = ["id", "name", "slug", "description", "product_count"]
        read_only_fields = ["id", "product_count"]
        extra_kwargs = {"slug": {"required": False}}

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if not attrs.get("slug") and "name" in attrs:
            attrs["slug"] = slugify(attrs["name"])
        return attrs


class CategoryRefSerializer(serializers.ModelSerializer[Category]):
    class Meta:
        model = Category
        fields = ["id", "name", "slug"]


class ProductSerializer(serializers.ModelSerializer[Product]):
    """Public, read-only representation used by the storefront."""

    category = CategoryRefSerializer(read_only=True)
    in_stock = serializers.BooleanField(read_only=True)

    class Meta:
        model = Product
        fields = [
            "id",
            "name",
            "slug",
            "sku",
            "description",
            "category",
            "price",
            "stock",
            "in_stock",
            "image_url",
            "is_featured",
            "created_at",
        ]
        read_only_fields = fields


class UpperCaseCharField(serializers.CharField):
    def to_internal_value(self, data: Any) -> str:
        return str(super().to_internal_value(data)).upper()


class AdminProductSerializer(serializers.ModelSerializer[Product]):
    sku = UpperCaseCharField(
        max_length=32,
        validators=[
            RegexValidator(r"^[A-Z0-9\-]+$", "SKU may contain A-Z, 0-9 and dashes."),
            UniqueValidator(queryset=Product.objects.all(), message="SKU already in use."),
        ],
    )
    category = CategoryRefSerializer(read_only=True)
    category_id = serializers.PrimaryKeyRelatedField(
        source="category", queryset=Category.objects.all(), write_only=True
    )
    in_stock = serializers.BooleanField(read_only=True)

    class Meta:
        model = Product
        fields = [
            "id",
            "name",
            "slug",
            "sku",
            "description",
            "category",
            "category_id",
            "price",
            "stock",
            "in_stock",
            "image_url",
            "is_active",
            "is_featured",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {"slug": {"required": False}}

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Name must be at least 2 characters.")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if not attrs.get("slug") and "name" in attrs and self.instance is None:
            base = slugify(attrs["name"]) or "product"
            slug, n = base, 2
            while Product.objects.filter(slug=slug).exists():
                slug, n = f"{base}-{n}", n + 1
            attrs["slug"] = slug
        return attrs


def snapshot(product: Product) -> dict[str, Any]:
    """Fields tracked in the audit log for product changes."""
    return {
        "name": product.name,
        "sku": product.sku,
        "price": str(product.price),
        "stock": product.stock,
        "category": product.category_id,
        "is_active": product.is_active,
        "is_featured": product.is_featured,
        "image_url": product.image_url,
    }
