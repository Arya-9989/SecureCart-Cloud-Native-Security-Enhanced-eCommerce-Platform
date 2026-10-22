from __future__ import annotations

import logging
from typing import Any

from django.db import models
from django.http import HttpRequest

from apps.audit.models import AuditLog
from apps.core.utils import client_ip

logger = logging.getLogger("securecart.audit")


def record(
    action: str,
    *,
    request: HttpRequest | None = None,
    actor: Any = None,
    target: models.Model | None = None,
    changes: dict[str, Any] | None = None,
) -> AuditLog:
    """Persist an audit event. ``actor`` defaults to the authenticated request user."""
    if actor is None and request is not None:
        user = getattr(request, "user", None)
        actor = user if user is not None and user.is_authenticated else None

    entry = AuditLog.objects.create(
        actor=actor,
        actor_email=getattr(actor, "email", "") or "",
        action=action,
        target_type=target._meta.label_lower if target is not None else "",
        target_id=str(target.pk) if target is not None else "",
        target_repr=str(target)[:200] if target is not None else "",
        changes=changes or {},
        ip_address=client_ip(request) if request is not None else None,
        user_agent=(request.headers.get("User-Agent", "")[:256] if request is not None else ""),
        request_id=(request.META.get("REQUEST_ID", "") if request is not None else ""),
    )
    logger.info(
        "audit action=%s actor=%s target=%s:%s",
        action,
        entry.actor_email,
        entry.target_type,
        entry.target_id,
    )
    return entry


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """Return ``{field: [old, new]}`` for fields whose value changed (JSON-safe)."""
    changed: dict[str, Any] = {}
    for key, new in after.items():
        old = before.get(key)
        if old != new:
            changed[key] = [_jsonable(old), _jsonable(new)]
    return changed


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, bool | int | float | str):
        return value
    return str(value)
