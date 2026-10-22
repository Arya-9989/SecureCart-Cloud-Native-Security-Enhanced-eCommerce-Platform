from rest_framework.request import Request
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView


class _PerIPThrottle(SimpleRateThrottle):
    """Keyed by client IP whether or not the request is authenticated.

    DRF's ``AnonRateThrottle`` returns no cache key for authenticated requests, which would
    leave credential endpoints that need a signed-in user (password change) unlimited.
    """

    def get_cache_key(self, request: Request, view: APIView) -> str:
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class AuthRateThrottle(_PerIPThrottle):
    """Per-IP limit for credential endpoints (login, register, password change)."""

    scope = "auth"


class RefreshRateThrottle(_PerIPThrottle):
    """Looser per-IP limit for silent token refresh, which runs on every page load."""

    scope = "auth_refresh"


class CheckoutRateThrottle(SimpleRateThrottle):
    scope = "checkout"

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        if not request.user or not request.user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}
