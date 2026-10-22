from __future__ import annotations

from typing import Any, cast

import django_filters
from django.db.models import Count, ProtectedError, Q, QuerySet
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import filters, viewsets
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer

from apps.accounts.permissions import IsAdminRole
from apps.audit import services as audit
from apps.catalog import cache as catalog_cache
from apps.catalog.models import Category, Product
from apps.catalog.serializers import (
    AdminProductSerializer,
    CategorySerializer,
    ProductSerializer,
    snapshot,
)
from apps.core.exceptions import Conflict


class ProductFilter(django_filters.FilterSet):
    category = django_filters.CharFilter(field_name="category__slug")
    min_price = django_filters.NumberFilter(field_name="price", lookup_expr="gte")
    max_price = django_filters.NumberFilter(field_name="price", lookup_expr="lte")
    in_stock = django_filters.BooleanFilter(method="filter_in_stock")
    featured = django_filters.BooleanFilter(field_name="is_featured")

    class Meta:
        model = Product
        fields = ["category", "min_price", "max_price", "in_stock", "featured"]

    def filter_in_stock(
        self, queryset: QuerySet[Product], name: str, value: bool | None
    ) -> QuerySet[Product]:
        if value is None:
            return queryset
        return queryset.filter(stock__gt=0) if value else queryset.filter(stock=0)


class AdminProductFilter(ProductFilter):
    is_active = django_filters.BooleanFilter()
    low_stock = django_filters.NumberFilter(field_name="stock", lookup_expr="lte")

    class Meta(ProductFilter.Meta):
        fields = [*ProductFilter.Meta.fields, "is_active", "low_stock"]


_PRODUCT_ORDERING = ["price", "name", "created_at", "stock"]


@extend_schema_view(
    list=extend_schema(tags=["catalog"], summary="Browse, search and filter active products"),
    retrieve=extend_schema(tags=["catalog"], summary="Product detail by slug"),
)
class ProductViewSet(viewsets.ReadOnlyModelViewSet[Product]):
    serializer_class = ProductSerializer
    permission_classes = [AllowAny]
    lookup_field = "slug"
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ProductFilter
    search_fields = ["name", "description", "sku", "category__name"]
    ordering_fields = _PRODUCT_ORDERING
    ordering = ["-is_featured", "-created_at"]

    def get_queryset(self) -> QuerySet[Product]:
        return Product.objects.filter(is_active=True).select_related("category")

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return catalog_cache.cached(request, lambda: super(ProductViewSet, self).list(request))

    def retrieve(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return catalog_cache.cached(
            request, lambda: super(ProductViewSet, self).retrieve(request, *args, **kwargs)
        )


@extend_schema_view(
    list=extend_schema(tags=["catalog"], summary="List categories with active product counts"),
    retrieve=extend_schema(tags=["catalog"]),
)
class CategoryViewSet(viewsets.ReadOnlyModelViewSet[Category]):
    serializer_class = CategorySerializer
    permission_classes = [AllowAny]
    lookup_field = "slug"
    pagination_class = None

    def get_queryset(self) -> QuerySet[Category]:
        return Category.objects.annotate(
            product_count=Count("products", filter=Q(products__is_active=True))
        )

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return catalog_cache.cached(request, lambda: super(CategoryViewSet, self).list(request))


@extend_schema_view(
    list=extend_schema(tags=["admin"], summary="List all products, including inactive"),
    create=extend_schema(tags=["admin"], summary="Create a product"),
    retrieve=extend_schema(tags=["admin"]),
    update=extend_schema(tags=["admin"]),
    partial_update=extend_schema(tags=["admin"], summary="Update a product / adjust stock"),
    destroy=extend_schema(tags=["admin"], summary="Delete a product without order history"),
)
class AdminProductViewSet(viewsets.ModelViewSet[Product]):
    serializer_class = AdminProductSerializer
    permission_classes = [IsAdminRole]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = AdminProductFilter
    search_fields = ["name", "sku"]
    ordering_fields = _PRODUCT_ORDERING
    ordering = ["-created_at"]

    def get_queryset(self) -> QuerySet[Product]:
        return Product.objects.select_related("category")

    def perform_create(self, serializer: BaseSerializer[Product]) -> None:
        product = serializer.save()
        audit.record(
            "admin.product.created", request=self.request, target=product, changes=snapshot(product)
        )

    def perform_update(self, serializer: BaseSerializer[Product]) -> None:
        before = snapshot(cast(Product, serializer.instance))
        product = serializer.save()
        changes = audit.diff(before, snapshot(product))
        if changes:
            audit.record(
                "admin.product.updated", request=self.request, target=product, changes=changes
            )

    def perform_destroy(self, instance: Product) -> None:
        details = snapshot(instance)
        target_id = instance.pk
        try:
            instance.delete()
        except ProtectedError as exc:
            raise Conflict(
                "This product appears in past orders. Deactivate it instead of deleting it."
            ) from exc
        instance.pk = target_id
        audit.record(
            "admin.product.deleted", request=self.request, target=instance, changes=details
        )


@extend_schema_view(
    list=extend_schema(tags=["admin"]),
    create=extend_schema(tags=["admin"]),
    retrieve=extend_schema(tags=["admin"]),
    update=extend_schema(tags=["admin"]),
    partial_update=extend_schema(tags=["admin"]),
    destroy=extend_schema(tags=["admin"]),
)
class AdminCategoryViewSet(viewsets.ModelViewSet[Category]):
    serializer_class = CategorySerializer
    permission_classes = [IsAdminRole]
    pagination_class = None

    def get_queryset(self) -> QuerySet[Category]:
        return Category.objects.annotate(product_count=Count("products"))

    def perform_create(self, serializer: BaseSerializer[Category]) -> None:
        category = serializer.save()
        audit.record(
            "admin.category.created",
            request=self.request,
            target=category,
            changes={"name": category.name, "slug": category.slug},
        )

    def perform_update(self, serializer: BaseSerializer[Category]) -> None:
        current = cast(Category, serializer.instance)
        before: dict[str, Any] = {
            "name": current.name,
            "slug": current.slug,
        }
        category = serializer.save()
        changes = audit.diff(before, {"name": category.name, "slug": category.slug})
        if changes:
            audit.record(
                "admin.category.updated", request=self.request, target=category, changes=changes
            )

    def perform_destroy(self, instance: Category) -> None:
        target_id = instance.pk
        try:
            instance.delete()
        except ProtectedError as exc:
            raise Conflict("Move or delete this category's products first.") from exc
        instance.pk = target_id
        audit.record(
            "admin.category.deleted",
            request=self.request,
            target=instance,
            changes={"name": instance.name},
        )

