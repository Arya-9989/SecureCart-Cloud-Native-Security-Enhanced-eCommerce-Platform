"""JWT issuance, rotation and revocation built on SimpleJWT's blacklist app."""

from __future__ import annotations

import contextlib
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.db import transaction
from django.db.models import F
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


#: Claim holding the session epoch a token was issued in (copied into access tokens).
EPOCH_CLAIM = "sev"


def issue_tokens(user: User) -> TokenPair:
    refresh = RefreshToken.for_user(user)
    refresh[EPOCH_CLAIM] = user.session_epoch
    return TokenPair(access=str(refresh.access_token), refresh=str(refresh))


def token_epoch(payload: Any) -> int:
    """Epoch a token was issued in. Tokens minted before epochs existed count as epoch 0."""
    value = payload.get(EPOCH_CLAIM, 0)
    return value if isinstance(value, int) else -1


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
    jti = old.payload.get(_jwt().get("JTI_CLAIM", "jti"))
    pair: TokenPair | None = None
    with transaction.atomic():
        # Requests presenting the same token queue on its row, so "is it still unused?" and
        # "mark it used" cannot interleave. A request that loses that race finds the token
        # already blacklisted: it is a replay like any other and must not mint a second live
        # session. Because it waited for the winner to commit, the winner's new token exists
        # by now and is revoked along with the rest.
        list(OutstandingToken.objects.select_for_update(of=("self",)).filter(jti=jti).order_by())
        first_use = not BlacklistedToken.objects.filter(token__jti=jti).exists()
        old.blacklist()
        user = User.objects.filter(pk=user_id, is_active=True).first() if user_id else None
        revoked = user is not None and token_epoch(old.payload) != user.session_epoch
        if user is not None and not revoked:
            if first_use:
                pair = issue_tokens(user)
            else:
                revoke_all(user)
    if user is None:
        raise RefreshRejected("User is inactive or no longer exists.")
    if revoked:
        # Every session was ended (password reset, role change, theft) after this token was
        # issued. This also closes the race where a rotation commits a fresh token while a
        # revocation is in progress: that token carries the old epoch and dies here.
        raise RefreshRejected("Session was revoked.")
    if pair is None:
        raise RefreshRejected("Token was already rotated.", reuse_detected_for=user)
    return user, pair


def revoke(raw_refresh: str) -> None:
    with contextlib.suppress(TokenError):  # already invalid: nothing to revoke
        RefreshToken(raw_refresh).blacklist()  # type: ignore[arg-type]


def revoke_all(user: User) -> int:
    """End every session of ``user``: refresh tokens *and* unexpired access tokens.

    Bumping the session epoch invalidates every token issued so far (access tokens are
    checked against it on each request); blacklisting the refresh tokens keeps the explicit
    record. The epoch moves first, so a refresh racing this call cannot mint a token that
    outlives it. ``user`` is updated in place, so tokens issued afterwards are valid.
    Returns the number of refresh tokens blacklisted.
    """
    User.objects.filter(pk=user.pk).update(session_epoch=F("session_epoch") + 1)
    user.refresh_from_db(fields=["session_epoch"])
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
