"""Bearer authentication that honours server-side session revocation.

A JWT access token is valid until it expires, so on its own "revoke every session" (password
reset, role change, refresh-token theft) would leave already-issued access tokens working for
up to ``JWT_ACCESS_MINUTES``. Each token therefore carries the user's session epoch, and the
epoch is compared with the database on every request. ``tokens.revoke_all`` bumps it, which
ends every outstanding token at once. The user row is loaded on every request anyway (roles
are read from the database), so the check costs nothing extra.
"""

from __future__ import annotations

from typing import Any

from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.accounts.tokens import token_epoch


class SessionJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token: Any) -> Any:
        user = super().get_user(validated_token)
        if token_epoch(validated_token) != getattr(user, "session_epoch", None):
            raise AuthenticationFailed("Session was revoked.", code="session_revoked")
        return user
