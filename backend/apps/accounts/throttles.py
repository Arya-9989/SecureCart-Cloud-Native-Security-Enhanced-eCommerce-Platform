import hashlib

from rest_framework.request import Request
from rest_framework.views import APIView

from apps.core.throttling import AtomicRateThrottle


class _PerIPThrottle(AtomicRateThrottle):
    """Keyed by client IP whether or not the request is authenticated.

    DRF's ``AnonRateThrottle`` returns no cache key for authenticated requests, which would
    leave credential endpoints that need a signed-in user (password change) unlimited.
    """

    def get_cache_key(self, request: Request, view: APIView) -> str:
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class AuthRateThrottle(_PerIPThrottle):
    """Per-IP limit for credential endpoints (login, register, password change)."""

    scope = "auth"
    fail_open = False  # never allow unlimited password guessing because Redis is down


class RefreshRateThrottle(_PerIPThrottle):
    """Looser per-IP limit for silent token refresh, which runs on every page load."""

    scope = "auth_refresh"


class CheckoutRateThrottle(AtomicRateThrottle):
    scope = "checkout"

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        if not request.user or not request.user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}


class AccountEmailRateThrottle(_PerIPThrottle):
    """Per-IP limit for endpoints that send email (forgot password, resend verification)."""

    scope = "account_email"
    fail_open = False


class AccountDataRateThrottle(AtomicRateThrottle):
    """Per-user limit for the data export (it reads the whole account history)."""

    scope = "account_data"

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        if not request.user or not request.user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}


class RecipientBudget(AtomicRateThrottle):
    """Per-recipient budget for account emails, keyed by a hash of the address.

    It is checked *silently*: when the budget is spent the endpoint still answers exactly as
    if it had sent the email, so the limit protects an inbox from being flooded without
    revealing whether that inbox has an account.
    """

    scope = "account_email_recipient"
    fail_open = False

    def __init__(self, purpose: str) -> None:
        super().__init__()
        self.purpose = purpose

    def get_cache_key(self, request: Request, view: APIView) -> str:  # pragma: no cover
        raise NotImplementedError("Use allow_for(email).")

    def allow_for(self, email: str) -> bool:
        if self.rate is None:
            return True
        digest = hashlib.sha256(email.strip().lower().encode()).hexdigest()[:32]
        key = self.cache_format % {"scope": f"{self.scope}:{self.purpose}", "ident": digest}
        return self.allow_key(key)
