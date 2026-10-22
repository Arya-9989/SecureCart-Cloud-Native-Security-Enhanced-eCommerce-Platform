"""JWT issuance, rotation and revocation built on SimpleJWT's blacklist app."""

from __future__ import annotations

import contextlib
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from rest_framework_simplejwt.exceptions import TokenBackendError, TokenError
from rest_framework_simplejwt.state import token_backend
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User


def _jwt() -> dict[str, Any]:
    jwt_settings: dict[str, Any] = settings.SIMPLE_JWT
    return jwt_settings


@dataclass(frozen=True)
class TokenPair:
    access: str
    refresh: str


class RefreshRejected(Exception):
    """The refresh token is missing, invalid, expired, revoked or belongs to an inactive user."""

    def __init__(self, reason: str, *, reuse_detected_for: User | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.reuse_detected_for = reuse_detected_for


def issue_tokens(user: User) -> TokenPair:
    refresh = RefreshToken.for_user(user)
    return TokenPair(access=str(refresh.access_token), refresh=str(refresh))


def rotate(raw_refresh: str) -> tuple[User, TokenPair]:
    """Exchange a refresh token for a new pair, blacklisting the old refresh token.

    If a token that was *already rotated* is presented again, someone is replaying a stolen
    token (or racing the legitimate client). We treat that as compromise and revoke every
    outstanding refresh token for the account, forcing a fresh login everywhere.
    """
    try:
        old = RefreshToken(raw_refresh)  # type: ignore[arg-type]
    except TokenError as exc:
        reused_by = _owner_if_replayed(raw_refresh)
        if reused_by is not None:
            revoke_all(reused_by)
        raise RefreshRejected(str(exc), reuse_detected_for=reused_by) from exc

    user_id = old.payload.get(_jwt()["USER_ID_CLAIM"])
    user = User.objects.filter(pk=user_id, is_active=True).first() if user_id else None
    old.blacklist()
    if user is None:
        raise RefreshRejected("User is inactive or no longer exists.")
    return user, issue_tokens(user)


def revoke(raw_refresh: str) -> None:
    with contextlib.suppress(TokenError):  # already invalid: nothing to revoke
        RefreshToken(raw_refresh).blacklist()  # type: ignore[arg-type]


def revoke_all(user: User) -> int:
    """Blacklist every outstanding refresh token for ``user``. Returns the number revoked."""
    pending = OutstandingToken.objects.filter(user=user).exclude(
        id__in=BlacklistedToken.objects.filter(token__user=user).values("token_id")
    )
    created = BlacklistedToken.objects.bulk_create(
        [BlacklistedToken(token=token) for token in pending], ignore_conflicts=True
    )
    return len(created)


def _owner_if_replayed(raw_refresh: str) -> User | None:
    """Return the token's owner iff the token is authentic, unexpired and already blacklisted."""
    try:
        payload = token_backend.decode(raw_refresh, verify=True)  # type: ignore[arg-type]
    except TokenBackendError:
        return None
    jti = payload.get(_jwt().get("JTI_CLAIM", "jti"))
    if payload.get("token_type") != "refresh" or not jti:
        return None
    if not BlacklistedToken.objects.filter(token__jti=jti).exists():
        return None
    user_id = payload.get(_jwt()["USER_ID_CLAIM"])
    return User.objects.filter(pk=user_id).first() if user_id else None
