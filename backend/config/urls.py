from django.urls import URLPattern, URLResolver, include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerSplitView,
)
from rest_framework.routers import DefaultRouter

from apps.accounts.views import AdminUserViewSet
from apps.audit.views import AuditLogViewSet
from apps.cart.views import CartItemDetailView, CartItemsView, CartView
from apps.catalog.views import (
    AdminCategoryViewSet,
    AdminProductViewSet,
    CategoryViewSet,
    ProductViewSet,
)
from apps.core.views import HealthView
from apps.dashboard.views import DashboardView
from apps.orders.views import AdminOrderViewSet, CheckoutView, OrderViewSet

public = DefaultRouter(trailing_slash=True)
public.include_root_view = False
public.register("products", ProductViewSet, basename="product")
public.register("categories", CategoryViewSet, basename="category")
public.register("orders", OrderViewSet, basename="order")

admin = DefaultRouter(trailing_slash=True)
admin.include_root_view = False
admin.register("products", AdminProductViewSet, basename="admin-product")
admin.register("categories", AdminCategoryViewSet, basename="admin-category")
admin.register("orders", AdminOrderViewSet, basename="admin-order")
admin.register("users", AdminUserViewSet, basename="admin-user")
admin.register("audit-logs", AuditLogViewSet, basename="admin-audit-log")

api: list[URLPattern | URLResolver] = [
    path("health/", HealthView.as_view(), name="health"),
    path("auth/", include("apps.accounts.urls")),
    path("cart/", CartView.as_view(), name="cart"),
    path("cart/items/", CartItemsView.as_view(), name="cart-items"),
    path("cart/items/<int:item_id>/", CartItemDetailView.as_view(), name="cart-item"),
    path("checkout/", CheckoutView.as_view(), name="checkout"),
    path("admin/dashboard/", DashboardView.as_view(), name="admin-dashboard"),
    path("admin/", include(admin.urls)),
    path("", include(public.urls)),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("docs/", SpectacularSwaggerSplitView.as_view(url_name="schema"), name="swagger-ui"),
    path("redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]

urlpatterns = [path("api/", include(api))]
