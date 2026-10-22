from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle


class AuthRateThrottle(AnonRateThrottle):
    """Per-IP limit for credential endpoints (login/register/refresh) to slow brute force."""

    scope = "auth"


class CheckoutRateThrottle(SimpleRateThrottle):
    scope = "checkout"

    def get_cache_key(self, request, view):  # type: ignore[no-untyped-def]
        if not request.user or not request.user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}
