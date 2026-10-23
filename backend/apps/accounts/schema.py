"""OpenAPI description of the session-aware bearer scheme (same wire format as SimpleJWT)."""

from drf_spectacular.contrib.rest_framework_simplejwt import SimpleJWTScheme


class SessionJWTScheme(SimpleJWTScheme):  # type: ignore[no-untyped-call]
    target_class = "apps.accounts.authentication.SessionJWTAuthentication"
