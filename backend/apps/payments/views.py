from __future__ import annotations

import logging

from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.payments import webhooks
from apps.payments.registry import get_payment_provider

logger = logging.getLogger("securecart.payments")


class PaymentConfigView(APIView):
    """Which provider checkout talks to, and the test payment methods it accepts."""

    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(
        responses=inline_serializer(
            "PaymentConfig",
            {
                "provider": serializers.CharField(),
                "mode": serializers.ChoiceField(choices=["offline", "test", "live"]),
                "confirms_asynchronously": serializers.BooleanField(),
                "test_methods": inline_serializer(
                    "TestMethod",
                    {
                        "token": serializers.CharField(),
                        "label": serializers.CharField(),
                        "description": serializers.CharField(),
                    },
                    many=True,
                ),
            },
        ),
        tags=["payments"],
        summary="Payment provider and test methods for the checkout page",
    )
    def get(self, request: Request) -> Response:
        return Response(get_payment_provider().describe())


@csrf_exempt  # authenticated by the Stripe signature, not by a session
@require_POST
def stripe_webhook(request: HttpRequest) -> JsonResponse:
    """Receive Stripe events. Must read the raw body: re-serialised JSON would not verify."""
    try:
        event = webhooks.verify(request.body, request.headers.get("Stripe-Signature"))
    except webhooks.InvalidWebhook as exc:
        logger.warning("stripe webhook rejected: %s", exc)
        return JsonResponse(
            {"error": {"code": "invalid_webhook", "message": "Webhook rejected."}}, status=400
        )
    outcome = webhooks.handle(event)
    return JsonResponse({"received": True, "outcome": outcome})
