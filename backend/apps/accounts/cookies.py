"""Helpers for the httpOnly refresh-token cookie."""

from __future__ import annotations

from typing import Any

from django.conf import settings
from rest_framework.request import Request
from rest_framework.response import Response

CSRF_HEADER = "X-CSRF-Protection"


def _cfg() -> dict[str, Any]:
    cfg: dict[str, Any] = settings.REFRESH_COOKIE
    return cfg


def set_refresh_cookie(response: Response, token: str) -> None:
    cfg = _cfg()
    lifetime = settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]
    max_age = int(lifetime.total_seconds())
    response.set_cookie(
        cfg["NAME"],
        token,
        max_age=max_age,
        path=cfg["PATH"],
        secure=cfg["SECURE"],
        httponly=cfg["HTTPONLY"],
        samesite=cfg["SAMESITE"],
    )


def clear_refresh_cookie(response: Response) -> None:
    cfg = _cfg()
    response.delete_cookie(cfg["NAME"], path=cfg["PATH"], samesite=cfg["SAMESITE"])


def read_refresh_cookie(request: Request) -> str | None:
    value: str | None = request.COOKIES.get(_cfg()["NAME"])
    return value


def has_csrf_header(request: Request) -> bool:
    """Cookie-authenticated endpoints require a custom header.

    Browsers refuse to attach custom headers to cross-origin requests without a CORS
    preflight, which our CORS policy rejects. Together with ``SameSite=Strict`` this is a
    defense-in-depth CSRF guard for the only endpoints that read the refresh cookie.
    """
    return request.headers.get(CSRF_HEADER) == "1"
