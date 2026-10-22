import hashlib

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


class AccountEmailRateThrottle(_PerIPThrottle):
    """Per-IP limit for endpoints that send email (forgot password, resend verification)."""

    scope = "account_email"


class RecipientBudget(SimpleRateThrottle):
    """Per-recipient budget for account emails, keyed by a hash of the address.

    It is checked *silently*: when the budget is spent the endpoint still answers exactly as
    if it had sent the email, so the limit protects an inbox from being flooded without
    revealing whether that inbox has an account.
    """

    scope = "account_email_recipient"

    def __init__(self, purpose: str) -> None:
        super().__init__()
        self.purpose = purpose

    def get_cache_key(self, request: Request, view: APIView) -> str:  # pragma: no cover
        raise NotImplementedError("Use allow_for(email).")

    def allow_for(self, email: str) -> bool:
        if self.rate is None:
            return True
        digest = hashlib.sha256(email.strip().lower().encode()).hexdigest()[:32]
        self.key = self.cache_format % {"scope": f"{self.scope}:{self.purpose}", "ident": digest}
        self.history = self.cache.get(self.key, [])
        self.now = self.timer()
        num_requests, duration = self.parse_rate(self.rate)
        while self.history and self.history[-1] <= self.now - (duration or 0):
            self.history.pop()
        if len(self.history) >= (num_requests or 0):
            return False
        return bool(self.throttle_success())
