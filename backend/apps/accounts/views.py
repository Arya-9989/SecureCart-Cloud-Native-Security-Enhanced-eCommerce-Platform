from __future__ import annotations

import time
from typing import cast

from django.conf import settings
from django.contrib.auth import authenticate, password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, QuerySet
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    extend_schema_view,
)
from rest_framework import filters, mixins, status, viewsets
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer
from rest_framework.views import APIView

from apps.accounts import emails, onetime, selfservice, tokens
from apps.accounts.cookies import (
    clear_refresh_cookie,
    has_csrf_header,
    read_refresh_cookie,
    set_refresh_cookie,
)
from apps.accounts.models import TokenPurpose, User
from apps.accounts.permissions import IsAdminRole
from apps.accounts.serializers import (
    AdminUserSerializer,
    ChangePasswordSerializer,
    DeleteAccountSerializer,
    DetailSerializer,
    ForgotPasswordSerializer,
    LoginSerializer,
    RegisterSerializer,
    ResetPasswordSerializer,
    TokenResponseSerializer,
    TokenSerializer,
    UserSerializer,
)
from apps.accounts.throttles import (
    AccountDataRateThrottle,
    AccountEmailRateThrottle,
    AuthRateThrottle,
    RecipientBudget,
    RefreshRateThrottle,
)
from apps.audit import services as audit

INVALID_CREDENTIALS = "Invalid email or password."
INVALID_LINK = "This link is invalid or has expired. Ask for a new one."
RESET_REQUESTED = (
    "If an account exists for that address, we have sent it a link to choose a new password."
)


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
        with transaction.atomic():
            user = serializer.save()
            audit.record("auth.register", request=request, actor=user, target=user)
            _send_verification(user)
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
    throttle_classes = [RefreshRateThrottle]

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


class RevokeSessionsView(APIView):
    """Sign out everywhere: ends every session, including this one."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=None, responses={204: None}, tags=["auth"], summary="Sign out on every device"
    )
    def post(self, request: Request) -> Response:
        user = cast(User, request.user)
        revoked = tokens.revoke_all(user)
        audit.record(
            "auth.sessions_revoked", request=request, target=user, changes={"revoked": revoked}
        )
        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_refresh_cookie(response)
        return response


class ExportDataView(APIView):
    """Everything the store holds about the signed-in user, as a JSON download."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [AccountDataRateThrottle]

    @extend_schema(
        responses={(200, "application/json"): OpenApiTypes.OBJECT},
        tags=["auth"],
        summary="Download a copy of my data (profile, orders, bag, account activity)",
    )
    def get(self, request: Request) -> Response:
        user = cast(User, request.user)
        audit.record("auth.data_exported", request=request, target=user)
        response = Response(selfservice.export(user))
        stamp = timezone.now().strftime("%Y%m%d")
        response["Content-Disposition"] = f'attachment; filename="securecart-data-{stamp}.json"'
        return response


class DeleteAccountView(APIView):
    """Delete (anonymise) the signed-in account after re-entering the password."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [AuthRateThrottle]

    @extend_schema(
        request=DeleteAccountSerializer,
        responses={
            204: None,
            400: OpenApiResponse(description="Wrong password"),
            409: OpenApiResponse(description="Open orders, or an administrator account"),
        },
        tags=["auth"],
        summary="Delete my account (orders are kept, anonymised, for accounting)",
    )
    def post(self, request: Request) -> Response:
        serializer = DeleteAccountSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = cast(User, request.user)
        if not user.check_password(serializer.validated_data["password"]):
            raise ValidationError({"password": ["Incorrect password."]})
        try:
            selfservice.delete(user)
        except selfservice.DeletionRefused as exc:
            return Response(
                {"error": {"code": exc.code, "message": exc.message}},
                status=status.HTTP_409_CONFLICT,
            )
        audit.record("auth.account_deleted", request=request, actor=user, target=user)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_refresh_cookie(response)
        return response


def _send_verification(user: User) -> None:
    """Issue a verification link and queue the email (sent after the transaction commits)."""
    secret = onetime.issue(user, TokenPurpose.VERIFY_EMAIL)
    emails.send(emails.verification_email(user, secret))


class VerifyEmailView(CredentialView):
    """Confirm an address from the emailed link. Works in any browser, signed in or not."""

    throttle_classes = [AuthRateThrottle]

    @extend_schema(
        request=TokenSerializer,
        responses={200: DetailSerializer, 400: OpenApiResponse(description="Invalid link")},
        tags=["auth"],
        summary="Confirm an email address with the one-time token from the link",
    )
    def post(self, request: Request) -> Response:
        serializer = TokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            try:
                user = onetime.consume(
                    serializer.validated_data["token"], TokenPurpose.VERIFY_EMAIL
                )
            except onetime.InvalidToken:
                raise ValidationError({"token": [INVALID_LINK]}) from None
            if user.email_verified_at is None:
                user.email_verified_at = timezone.now()
                user.save(update_fields=["email_verified_at"])
            audit.record("auth.email_verified", request=request, actor=user, target=user)
        return Response({"detail": "Your email address is confirmed."})


class ResendVerificationView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [AccountEmailRateThrottle]

    @extend_schema(
        request=None,
        responses={202: DetailSerializer, 200: DetailSerializer},
        tags=["auth"],
        summary="Email a new verification link to the signed-in user",
    )
    def post(self, request: Request) -> Response:
        user = cast(User, request.user)
        if user.email_verified:
            return Response({"detail": "Your email address is already confirmed."})
        if RecipientBudget(TokenPurpose.VERIFY_EMAIL).allow_for(user.email):
            with transaction.atomic():
                _send_verification(user)
                audit.record("auth.verification_sent", request=request, target=user)
        # Same answer when the per-inbox budget is spent: the links already sent still work.
        return Response(
            {"detail": f"We sent a new link to {user.email}."}, status=status.HTTP_202_ACCEPTED
        )


def _respond_no_sooner_than(started: float, response: Response) -> Response:
    """Pad a response to a fixed minimum duration (``ACCOUNT_RECOVERY_MIN_RESPONSE_MS``)."""
    remaining = settings.ACCOUNT_RECOVERY_MIN_RESPONSE_MS / 1000 - (time.perf_counter() - started)
    if remaining > 0:
        time.sleep(remaining)
    return response


class ForgotPasswordView(CredentialView):
    """Start a password reset without revealing whether the address has an account.

    Every request gets the same status, body and headers, and none returns before
    ``ACCOUNT_RECOVERY_MIN_RESPONSE_MS``. The email goes out on a background thread after the
    transaction commits, so SMTP latency never shows in the response time.
    """

    throttle_classes = [AccountEmailRateThrottle]

    @extend_schema(
        request=ForgotPasswordSerializer,
        responses={202: DetailSerializer},
        tags=["auth"],
        summary="Email a password-reset link (identical answer whether or not it exists)",
    )
    def post(self, request: Request) -> Response:
        started = time.perf_counter()
        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()
        # Spent for every address, registered or not, so the budget is not an oracle either.
        within_budget = RecipientBudget(TokenPurpose.RESET_PASSWORD).allow_for(email)
        with transaction.atomic():
            user = User.objects.filter(email__iexact=email, is_active=True).first()
            sent = user is not None and within_budget
            if user is not None and sent:
                secret = onetime.issue(user, TokenPurpose.RESET_PASSWORD)
                emails.send(emails.password_reset_email(user, secret))
            audit.record(
                "auth.password_reset_requested",
                request=request,
                target=user,
                changes={"email": email, "sent": sent},
            )
        response = Response({"detail": RESET_REQUESTED}, status=status.HTTP_202_ACCEPTED)
        return _respond_no_sooner_than(started, response)


class ResetPasswordView(CredentialView):
    throttle_classes = [AuthRateThrottle]

    @extend_schema(
        request=ResetPasswordSerializer,
        responses={200: DetailSerializer, 400: OpenApiResponse(description="Invalid link")},
        tags=["auth"],
        summary="Choose a new password with the emailed token; ends every session",
    )
    def post(self, request: Request) -> Response:
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_password = serializer.validated_data["new_password"]
        with transaction.atomic():
            # Consuming and applying share one transaction: a rejected password rolls the
            # consumption back, so the same link works for the next attempt.
            try:
                user = onetime.consume(
                    serializer.validated_data["token"], TokenPurpose.RESET_PASSWORD
                )
            except onetime.InvalidToken:
                raise ValidationError({"token": [INVALID_LINK]}) from None
            try:
                password_validation.validate_password(new_password, user=user)
            except DjangoValidationError as exc:
                raise ValidationError({"new_password": list(exc.messages)}) from exc
            user.set_password(new_password)
            fields = ["password"]
            if user.email_verified_at is None:
                # The link reached this inbox, which proves the address as well.
                user.email_verified_at = timezone.now()
                fields.append("email_verified_at")
            user.save(update_fields=fields)
            revoked = tokens.revoke_all(user)
            onetime.revoke_outstanding(user, TokenPurpose.RESET_PASSWORD)
            audit.record(
                "auth.password_reset",
                request=request,
                actor=user,
                target=user,
                changes={"refresh_tokens_revoked": revoked},
            )
            emails.send(emails.password_changed_email(user))
        return Response({"detail": "Your password has been changed. Sign in with it now."})


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
