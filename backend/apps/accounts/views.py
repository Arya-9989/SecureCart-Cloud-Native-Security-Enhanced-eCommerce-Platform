from __future__ import annotations

from typing import cast

from django.contrib.auth import authenticate
from django.db import transaction
from django.db.models import Count, QuerySet
from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    extend_schema_view,
)
from rest_framework import filters, mixins, status, viewsets
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer
from rest_framework.views import APIView

from apps.accounts import tokens
from apps.accounts.cookies import (
    clear_refresh_cookie,
    has_csrf_header,
    read_refresh_cookie,
    set_refresh_cookie,
)
from apps.accounts.models import User
from apps.accounts.permissions import IsAdminRole
from apps.accounts.serializers import (
    AdminUserSerializer,
    ChangePasswordSerializer,
    LoginSerializer,
    RegisterSerializer,
    TokenResponseSerializer,
    UserSerializer,
)
from apps.accounts.throttles import AuthRateThrottle
from apps.audit import services as audit

INVALID_CREDENTIALS = "Invalid email or password."


def _token_response(user: User, pair: tokens.TokenPair, status_code: int = 200) -> Response:
    response = Response(
        {"access": pair.access, "user": UserSerializer(user).data}, status=status_code
    )
    set_refresh_cookie(response, pair.refresh)
    return response


class CredentialView(APIView):
    """Base for endpoints that authenticate via credentials or the refresh cookie.

    They skip bearer-token authentication, but still answer failures with ``401`` and a
    ``WWW-Authenticate`` challenge rather than DRF's default ``403``.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get_authenticate_header(self, request: Request) -> str:
        return 'Bearer realm="api"'


class RegisterView(CredentialView):
    throttle_classes = [AuthRateThrottle]

    @extend_schema(
        request=RegisterSerializer,
        responses={201: TokenResponseSerializer},
        tags=["auth"],
        summary="Create a customer account and start a session",
    )
    def post(self, request: Request) -> Response:
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        audit.record("auth.register", request=request, actor=user, target=user)
        return _token_response(user, tokens.issue_tokens(user), status.HTTP_201_CREATED)


class LoginView(CredentialView):
    throttle_classes = [AuthRateThrottle]

    @extend_schema(
        request=LoginSerializer,
        responses={200: TokenResponseSerializer, 401: OpenApiResponse(description="Bad login")},
        tags=["auth"],
        summary="Exchange credentials for an access token (refresh token set as httpOnly cookie)",
    )
    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()
        user = authenticate(
            request._request, username=email, password=serializer.validated_data["password"]
        )
        if user is None:
            # One message for unknown email, wrong password and inactive account, so the
            # endpoint cannot be used to enumerate users. Django's ModelBackend also runs the
            # hasher for unknown users to equalise response timing.
            audit.record("auth.login_failed", request=request, changes={"email": email})
            raise AuthenticationFailed(INVALID_CREDENTIALS)
        account = user
        audit.record("auth.login", request=request, actor=account, target=account)
        return _token_response(account, tokens.issue_tokens(account))


class RefreshView(CredentialView):
    throttle_classes = [AuthRateThrottle]

    @extend_schema(
        request=None,
        responses={200: TokenResponseSerializer, 401: OpenApiResponse(description="No session")},
        tags=["auth"],
        summary="Rotate the refresh cookie and return a new access token",
        description="Requires the refresh cookie and the `X-CSRF-Protection: 1` header.",
    )
    def post(self, request: Request) -> Response:
        if not has_csrf_header(request):
            raise PermissionDenied("Missing X-CSRF-Protection header.")
        raw = read_refresh_cookie(request)
        if not raw:
            raise AuthenticationFailed("No active session.")
        try:
            user, pair = tokens.rotate(raw)
        except tokens.RefreshRejected as exc:
            if exc.reuse_detected_for is not None:
                audit.record(
                    "auth.refresh_reuse_detected",
                    request=request,
                    actor=exc.reuse_detected_for,
                    target=exc.reuse_detected_for,
                )
            response = Response(
                {"error": {"code": "session_expired", "message": "Session expired."}},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            clear_refresh_cookie(response)
            return response
        return _token_response(user, pair)


class LogoutView(CredentialView):
    @extend_schema(request=None, responses={204: None}, tags=["auth"], summary="End the session")
    def post(self, request: Request) -> Response:
        if not has_csrf_header(request):
            raise PermissionDenied("Missing X-CSRF-Protection header.")
        raw = read_refresh_cookie(request)
        if raw:
            tokens.revoke(raw)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_refresh_cookie(response)
        return response


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=UserSerializer, tags=["auth"], summary="Current user profile")
    def get(self, request: Request) -> Response:
        return Response(UserSerializer(cast(User, request.user)).data)

    @extend_schema(
        request=UserSerializer, responses=UserSerializer, tags=["auth"], summary="Update profile"
    )
    def patch(self, request: Request) -> Response:
        serializer = UserSerializer(cast(User, request.user), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [AuthRateThrottle]

    @extend_schema(
        request=ChangePasswordSerializer,
        responses={200: TokenResponseSerializer},
        tags=["auth"],
        summary="Change password and revoke every existing session",
    )
    def post(self, request: Request) -> Response:
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = cast(User, request.user)
        with transaction.atomic():
            user.set_password(serializer.validated_data["new_password"])
            user.save(update_fields=["password"])
            tokens.revoke_all(user)
        audit.record("auth.password_changed", request=request, target=user)
        return _token_response(user, tokens.issue_tokens(user))


@extend_schema_view(
    list=extend_schema(
        tags=["admin"],
        summary="List users",
        parameters=[OpenApiParameter("role", str, enum=["admin", "customer"])],
    ),
    retrieve=extend_schema(tags=["admin"], summary="Get a user"),
    partial_update=extend_schema(tags=["admin"], summary="Change a user's role or status"),
)
class AdminUserViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet[User],
):
    """Administrators can list users, change roles and (de)activate accounts."""

    serializer_class = AdminUserSerializer
    permission_classes = [IsAdminRole]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["email", "full_name"]
    ordering_fields = ["date_joined", "email", "last_login"]
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self) -> QuerySet[User]:
        queryset = User.objects.annotate(order_count=Count("orders"))
        role = self.request.query_params.get("role")
        if role:
            queryset = queryset.filter(role=role)
        return queryset.order_by("-date_joined")

    def perform_update(self, serializer: BaseSerializer[User]) -> None:
        instance = cast(User, serializer.instance)
        before = {"role": instance.role, "is_active": instance.is_active}
        with transaction.atomic():
            user = serializer.save()
            changes = audit.diff(before, {"role": user.role, "is_active": user.is_active})
            if changes:
                # A privilege or status change invalidates that user's existing sessions.
                tokens.revoke_all(user)
                audit.record(
                    "admin.user.updated", request=self.request, target=user, changes=changes
                )
