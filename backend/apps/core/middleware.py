"""Cross-cutting HTTP middleware: security headers and request correlation IDs."""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable

from django.conf import settings
from django.http import HttpRequest, HttpResponse

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9\-]{8,64}$")


class SecurityHeadersMiddleware:
    """Adds headers Django's SecurityMiddleware does not cover (CSP, Permissions-Policy).

    API responses additionally get ``Cache-Control: no-store`` so authenticated JSON
    (orders, carts, profiles) is never written to shared or browser caches.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response
        self.csp: str = settings.CONTENT_SECURITY_POLICY
        self.permissions_policy: str = settings.PERMISSIONS_POLICY

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        response.headers.setdefault("Content-Security-Policy", self.csp)
        response.headers.setdefault("Permissions-Policy", self.permissions_policy)
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        if request.path.startswith("/api/") and not request.path.startswith("/api/docs"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response


class RequestIDMiddleware:
    """Propagates (or generates) an ``X-Request-ID`` so logs can be correlated across hops."""

    header = "X-Request-ID"

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        incoming = request.headers.get(self.header, "")
        request_id = incoming if _REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex
        request.META["REQUEST_ID"] = request_id
        response = self.get_response(request)
        response.headers[self.header] = request_id
        return response
