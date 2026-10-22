from __future__ import annotations

from typing import Any, cast

import django_filters
from django.conf import settings
from django.db import transaction
from django.db.models import Count, ProtectedError, Q, QuerySet
from django.http import Http404, HttpRequest, HttpResponseBase, StreamingHttpResponse
from django.views.decorators.http import require_safe
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import OpenApiResponse, extend_schema, extend_schema_view
from rest_framework import exceptions, filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer

from apps.accounts.permissions import IsAdminRole
from apps.audit import services as audit
from apps.catalog import cache as catalog_cache
from apps.catalog import media
from apps.catalog.models import Category, Product
from apps.catalog.serializers import (
    AdminProductSerializer,
    CategorySerializer,
    ProductSerializer,
    snapshot,
)
from apps.core.exceptions import Conflict


class UploadsDisabled(exceptions.APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "Image uploads are not configured (set MEDIA_STORAGE)."
    default_code = "uploads_disabled"


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

    @extend_schema(
        request={
            "multipart/form-data": {
                "type": "object",
                "properties": {"image": {"type": "string", "format": "binary"}},
                "required": ["image"],
            }
        },
        responses={
            200: AdminProductSerializer,
            400: OpenApiResponse(description="Not an acceptable image"),
            413: OpenApiResponse(description="Larger than MAX_IMAGE_UPLOAD_BYTES"),
            503: OpenApiResponse(description="Uploads are not configured"),
        },
        tags=["admin"],
        summary="Upload a product image (JPEG, PNG or WebP; stored re-encoded as WebP)",
    )
    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser], url_path="image")
    def image(self, request: Request, pk: str | None = None) -> Response:
        product = self.get_object()
        backend = media.storage()
        if backend is None:
            raise UploadsDisabled
        declared = int(request.META.get("CONTENT_LENGTH") or 0)
        limit = settings.MAX_IMAGE_UPLOAD_BYTES
        if declared > limit + 64 * 1024:  # refuse before the body is parsed
            return _too_large(limit)
        upload = request.FILES.get("image")
        if upload is None:
            raise exceptions.ValidationError({"image": ["Choose an image to upload."]})
        if upload.size is not None and upload.size > limit:
            return _too_large(limit)
        try:
            processed = media.process(upload)
        except media.InvalidImage as exc:
            raise exceptions.ValidationError({"image": [str(exc)]}) from exc

        key = media.new_key(product.pk)
        backend.put(key, processed.data, processed.content_type)
        previous = media.key_from_url(product.image_url)
        before = snapshot(product)
        try:
            with transaction.atomic():
                product.image_url = media.MEDIA_PREFIX + key
                product.save(update_fields=["image_url", "updated_at"])
                audit.record(
                    "admin.product.image_uploaded",
                    request=request,
                    target=product,
                    changes={
                        **audit.diff(before, snapshot(product)),
                        "sha256": processed.sha256,
                        "bytes": len(processed.data),
                        "size": f"{processed.width}x{processed.height}",
                    },
                )
        except Exception:
            backend.delete(key)  # never leave an orphan for a change that did not happen
            raise
        if previous:
            transaction.on_commit(lambda: _delete_quietly(backend, previous))
        return Response(AdminProductSerializer(product, context={"request": request}).data)

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


def _too_large(limit: int) -> Response:
    return Response(
        {
            "error": {
                "code": "too_large",
                "message": f"Images must be {limit // (1024 * 1024)} MB or smaller.",
            }
        },
        status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
    )


def _delete_quietly(backend: media.MediaStorage, key: str) -> None:
    try:
        backend.delete(key)
    except Exception:  # an orphaned object is harmless; a failed request is not
        media.logger.warning("could not delete replaced image %s", key)


@require_safe
def serve_media(request: HttpRequest, key: str) -> HttpResponseBase:
    """Stream a stored product image with headers that stop any reinterpretation."""
    if not media.KEY_RE.match(key):
        raise Http404
    backend = media.storage()
    if backend is None:
        raise Http404
    try:
        stored = backend.get(key)
    except media.MediaNotFound as exc:
        raise Http404 from exc
    if stored.content_type != "image/webp":  # only ever written by media.process
        raise Http404
    response = StreamingHttpResponse(stored.body, content_type="image/webp")
    response["Content-Length"] = str(stored.length)
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    response["Content-Disposition"] = 'inline; filename="image.webp"'
    response["Cross-Origin-Resource-Policy"] = "same-origin"
    # Keys are random and never reused, so the bytes behind a URL never change.
    response["Cache-Control"] = "public, max-age=31536000, immutable"
    return response
