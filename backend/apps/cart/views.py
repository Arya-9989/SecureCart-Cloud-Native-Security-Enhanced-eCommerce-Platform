from __future__ import annotations

from typing import cast

from django.conf import settings
from django.db import transaction
from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.cart.models import Cart, CartItem
from apps.cart.serializers import AddCartItemSerializer, CartSerializer, UpdateCartItemSerializer
from apps.catalog.models import Product


def get_cart(user: User) -> Cart:
    cart, _ = Cart.objects.get_or_create(user=user)
    return cart


def _cart_response(user: User, status_code: int = status.HTTP_200_OK) -> Response:
    cart = Cart.objects.prefetch_related(
        Prefetch("items", queryset=CartItem.objects.select_related("product"))
    ).get(user=user)
    return Response(CartSerializer(cart).data, status=status_code)


def _check_quantity(product: Product, quantity: int) -> None:
    limit = min(product.stock, settings.MAX_CART_LINE_QUANTITY)
    if quantity > limit:
        if product.stock == 0:
            raise ValidationError({"quantity": "This product is out of stock."})
        raise ValidationError({"quantity": f"Only {limit} available for this product."})


class CartView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=CartSerializer, tags=["cart"], summary="Current user's cart")
    def get(self, request: Request) -> Response:
        user = cast(User, request.user)
        get_cart(user)
        return _cart_response(user)

    @extend_schema(responses={204: None}, tags=["cart"], summary="Empty the cart")
    def delete(self, request: Request) -> Response:
        CartItem.objects.filter(cart__user=cast(User, request.user)).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CartItemsView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=AddCartItemSerializer,
        responses={201: CartSerializer},
        tags=["cart"],
        summary="Add a product (increments quantity if already in the cart)",
    )
    def post(self, request: Request) -> Response:
        user = cast(User, request.user)
        serializer = AddCartItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        product = Product.objects.filter(
            pk=serializer.validated_data["product_id"], is_active=True
        ).first()
        if product is None:
            raise ValidationError({"product_id": "Product not found."})
        with transaction.atomic():
            cart = get_cart(user)
            item = CartItem.objects.select_for_update().filter(cart=cart, product=product).first()
            quantity = serializer.validated_data["quantity"] + (item.quantity if item else 0)
            _check_quantity(product, quantity)
            if item is None:
                CartItem.objects.create(cart=cart, product=product, quantity=quantity)
            else:
                item.quantity = quantity
                item.save(update_fields=["quantity"])
            cart.save(update_fields=["updated_at"])
        return _cart_response(user, status.HTTP_201_CREATED)


class CartItemDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _item(self, request: Request, item_id: int) -> CartItem:
        # Scoped to the requester's cart: another user's item id is simply "not found".
        return get_object_or_404(
            CartItem.objects.select_related("product"), pk=item_id, cart__user=request.user
        )

    @extend_schema(
        request=UpdateCartItemSerializer,
        responses=CartSerializer,
        tags=["cart"],
        summary="Set the quantity of a cart line",
    )
    def patch(self, request: Request, item_id: int) -> Response:
        item = self._item(request, item_id)
        serializer = UpdateCartItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        quantity = serializer.validated_data["quantity"]
        _check_quantity(item.product, quantity)
        item.quantity = quantity
        item.save(update_fields=["quantity"])
        return _cart_response(cast(User, request.user))

    @extend_schema(responses=CartSerializer, tags=["cart"], summary="Remove a cart line")
    def delete(self, request: Request, item_id: int) -> Response:
        self._item(request, item_id).delete()
        return _cart_response(cast(User, request.user))
