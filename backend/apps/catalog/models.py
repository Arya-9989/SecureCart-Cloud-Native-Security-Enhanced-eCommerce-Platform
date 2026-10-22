from __future__ import annotations

from decimal import Decimal

from django.core.validators import MinValueValidator, RegexValidator
from django.db import models
from django.db.models import Q

image_url_validator = RegexValidator(
    regex=r"^(/(?!/)[A-Za-z0-9._~/\-]*|https://[^\s\"'<>]+)$",
    message="Image must be a site-relative path (e.g. /products/x.svg) or an https:// URL.",
)


class Category(models.Model):
    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(max_length=80, unique=True)
    description = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "categories"

    def __str__(self) -> str:
        return self.name


class Product(models.Model):
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True)
    sku = models.CharField(
        max_length=32,
        unique=True,
        validators=[RegexValidator(r"^[A-Z0-9\-]+$", "SKU may contain A-Z, 0-9 and dashes.")],
    )
    description = models.TextField(max_length=4000, blank=True)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="products")
    price = models.DecimalField(
        max_digits=10, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))]
    )
    stock = models.PositiveIntegerField(default=0)
    image_url = models.CharField(max_length=500, blank=True, validators=[image_url_validator])
    is_active = models.BooleanField(default=True, help_text="Inactive products are hidden.")
    is_featured = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["is_active", "category"]),
            models.Index(fields=["price"]),
        ]
        constraints = [
            # Enforced by the database so no code path can create negative stock or
            # zero-priced items, even outside the ORM's validators.
            models.CheckConstraint(condition=Q(price__gt=0), name="product_price_positive"),
            models.CheckConstraint(condition=Q(stock__gte=0), name="product_stock_non_negative"),
        ]

    def __str__(self) -> str:
        return self.name

    @property
    def in_stock(self) -> bool:
        return self.stock > 0
