from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.catalog.models import Product


class Cart(models.Model):
    """Server-side cart: one per user, so it follows the customer across devices."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cart"
    )
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"Cart of {self.user}"


class CartItem(models.Model):
    cart = models.ForeignKey(Cart, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="+")
    quantity = models.PositiveIntegerField()
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["added_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["cart", "product"], name="cart_item_unique_product"),
            models.CheckConstraint(condition=Q(quantity__gte=1), name="cart_item_quantity_min"),
        ]

    def __str__(self) -> str:
        return f"{self.quantity} x {self.product}"
