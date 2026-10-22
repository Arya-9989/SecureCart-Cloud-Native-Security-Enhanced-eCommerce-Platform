from django.db import connection
from django.http import HttpRequest, JsonResponse
from drf_spectacular.utils import extend_schema, inline_serializer
from redis.exceptions import RedisError
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import ratelimit


class HealthView(APIView):
    """Liveness + readiness probe used by Docker/Kubernetes health checks.

    The database is required (503 without it). Redis, when configured, is reported but not
    required: the API keeps serving without it (the catalog goes uncached, general rate
    limits open, credential limits close), so pulling every replica out of rotation over a
    cache outage would turn a degradation into an outage.
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    @extend_schema(
        responses=inline_serializer(
            "Health",
            {
                "status": serializers.CharField(),
                "redis": serializers.CharField(required=False),
            },
        ),
        tags=["system"],
    )
    def get(self, request: Request) -> Response:
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
        except Exception:  # pragma: no cover - exercised only when the DB is down
            return Response({"status": "degraded"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        body = {"status": "ok"}
        client = ratelimit.redis_client()
        if client is not None:
            try:
                client.ping()
                body["redis"] = "ok"
            except RedisError:
                body["redis"] = "unavailable"
        return Response(body)


# ---------------------------------------------------------------------------------------
# Django-level error handlers. DRF's exception handler only covers errors raised inside API
# views; these keep the same {"error": {"code", "message"}} envelope for everything else
# (unknown /api/ routes, disallowed hosts, unhandled exceptions), and never include details.
# ---------------------------------------------------------------------------------------


def _envelope(code: str, message: str, http_status: int) -> JsonResponse:
    return JsonResponse({"error": {"code": code, "message": message}}, status=http_status)


def bad_request(request: HttpRequest, exception: Exception | None = None) -> JsonResponse:
    return _envelope("bad_request", "Bad request.", 400)


def permission_denied(request: HttpRequest, exception: Exception | None = None) -> JsonResponse:
    return _envelope("permission_denied", "You do not have permission to do that.", 403)


def not_found(request: HttpRequest, exception: Exception | None = None) -> JsonResponse:
    return _envelope("not_found", "Not found.", 404)


def server_error(request: HttpRequest) -> JsonResponse:
    return _envelope("server_error", "Something went wrong on our side. Please try again.", 500)
