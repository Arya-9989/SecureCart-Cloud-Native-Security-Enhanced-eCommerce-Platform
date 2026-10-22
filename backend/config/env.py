"""Tiny, dependency-free helpers for reading typed configuration from environment variables."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from django.core.exceptions import ImproperlyConfigured

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off", ""}


def env_str(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise ImproperlyConfigured(f"Required environment variable {name} is not set.")
    return value


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    lowered = raw.strip().lower()
    if lowered in _TRUE:
        return True
    if lowered in _FALSE:
        return False
    raise ImproperlyConfigured(f"{name} must be a boolean, got {raw!r}.")


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ImproperlyConfigured(f"{name} must be an integer, got {raw!r}.") from exc


def env_list(name: str, default: str = "") -> list[str]:
    raw = os.environ.get(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def parse_database_url(url: str) -> dict[str, Any]:
    """Convert ``postgres://user:pass@host:5432/db`` or ``sqlite:///path`` to Django settings."""
    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    if scheme == "sqlite":
        # sqlite:///relative.db -> "relative.db"; sqlite:////abs/path.db -> "/abs/path.db"
        path = parsed.path[1:] if parsed.path.startswith("/") else parsed.path
        return {"ENGINE": "django.db.backends.sqlite3", "NAME": path or ":memory:"}
    if scheme in {"postgres", "postgresql", "pgsql"}:
        options = {key: values[-1] for key, values in parse_qs(parsed.query).items()}
        return {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": unquote(parsed.path.lstrip("/")),
            "USER": unquote(parsed.username or ""),
            "PASSWORD": unquote(parsed.password or ""),
            "HOST": parsed.hostname or "",
            "PORT": str(parsed.port or ""),
            "OPTIONS": options,
            "CONN_MAX_AGE": 60,
            "CONN_HEALTH_CHECKS": True,
        }
    raise ImproperlyConfigured(f"Unsupported DATABASE_URL scheme: {scheme!r}")
