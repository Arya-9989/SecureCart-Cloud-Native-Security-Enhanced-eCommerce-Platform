from __future__ import annotations

from django.http import HttpRequest
from rest_framework.settings import api_settings


def client_ip(request: HttpRequest) -> str | None:
    """Best-effort client IP. X-Forwarded-For is only trusted when NUM_PROXIES is set.

    With ``NUM_PROXIES=N`` we take the N-th address from the right, i.e. the one appended by
    the outermost trusted proxy; anything further left is client-controlled.
    """
    num_proxies = int(api_settings.NUM_PROXIES or 0)
    forwarded = str(request.META.get("HTTP_X_FORWARDED_FOR", ""))
    if forwarded and num_proxies > 0:
        hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
        if hops:
            return hops[-min(num_proxies, len(hops))]
    remote = str(request.META.get("REMOTE_ADDR", ""))
    return remote or None
