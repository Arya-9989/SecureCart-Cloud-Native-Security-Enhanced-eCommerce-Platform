"""Consistent error envelope for every API error response."""

from __future__ import annotations

from typing import Any

from django.core.exceptions import PermissionDenied
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler


class Conflict(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The request conflicts with the current state of the resource."
    default_code = "conflict"


class PaymentRequired(exceptions.APIException):
    status_code = status.HTTP_402_PAYMENT_REQUIRED
    default_detail = "Payment was declined."
    default_code = "payment_declined"


def api_exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    """Wrap DRF errors as ``{"error": {"code", "message", "fields"?}}``.

    Field-level validation errors keep their structure under ``fields`` so forms can map
    them back to inputs; everything else gets a single human-readable message.
    """
    if isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, PermissionDenied):
        exc = exceptions.PermissionDenied()

    response = exception_handler(exc, context)
    if response is None or not isinstance(exc, exceptions.APIException):
        return response

    if isinstance(exc, exceptions.ValidationError):
        detail = response.data
        message = "Invalid input."
        if isinstance(detail, dict) and list(detail) == ["non_field_errors"]:
            message = str(detail["non_field_errors"][0])
        elif isinstance(detail, list) and detail:
            message = str(detail[0])
        body: dict[str, Any] = {"code": "invalid", "message": message}
        if isinstance(detail, dict):
            body["fields"] = detail
    else:
        codes = exc.get_codes()
        body = {
            "code": codes if isinstance(codes, str) else "error",
            "message": str(exc.detail) if not isinstance(exc.detail, dict | list) else str(exc),
        }
    response.data = {"error": body}
    return response
