"""Single-use, expiring, hashed-at-rest tokens for email verification and password reset.

- The secret is 32 random bytes (``secrets.token_urlsafe``); only its SHA-256 is stored.
  With 256 bits of entropy a fast hash is the right tool: there is nothing to brute-force,
  and lookups by hash keep the comparison out of Python (no timing side channel).
- Issuing a token supersedes every earlier unused token of the same purpose, so only the
  most recent email works.
- Consuming a token locks its row, so two concurrent requests with the same secret cannot
  both succeed.
- A token is bound to the address it was sent to and to an active account.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import OneTimeToken, TokenPurpose, User


class InvalidToken(Exception):
    """Unknown, expired, already used, superseded, or for an inactive or changed account."""


def hash_secret(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def lifetime(purpose: str) -> timedelta:
    if purpose == TokenPurpose.RESET_PASSWORD:
        return timedelta(minutes=settings.PASSWORD_RESET_TTL_MINUTES)
    return timedelta(hours=settings.EMAIL_VERIFICATION_TTL_HOURS)


def issue(user: User, purpose: str) -> str:
    """Create a token for ``user`` and return the raw secret (to be emailed, never stored)."""
    raw = secrets.token_urlsafe(32)
    now = timezone.now()
    with transaction.atomic():
        OneTimeToken.objects.filter(user=user, purpose=purpose, used_at__isnull=True).update(
            used_at=now
        )
        OneTimeToken.objects.create(
            user=user,
            purpose=purpose,
            token_hash=hash_secret(raw),
            email=user.email,
            expires_at=now + lifetime(purpose),
        )
    return raw


def consume(raw: str, purpose: str) -> User:
    """Mark the token used and return its user. Must run inside ``transaction.atomic``.

    The caller applies the token's effect in the same transaction, so a failure there (for
    example a password that fails validation) rolls the consumption back too.
    """
    if not raw or len(raw) > 128:
        raise InvalidToken
    token = (
        OneTimeToken.objects.select_for_update(of=("self",))
        .select_related("user")
        .filter(token_hash=hash_secret(raw), purpose=purpose)
        .first()
    )
    now = timezone.now()
    if (
        token is None
        or token.used_at is not None
        or token.expires_at <= now
        or not token.user.is_active
        or token.email.lower() != token.user.email.lower()
    ):
        raise InvalidToken
    token.used_at = now
    token.save(update_fields=["used_at"])
    return token.user


def revoke_outstanding(user: User, purpose: str) -> None:
    OneTimeToken.objects.filter(user=user, purpose=purpose, used_at__isnull=True).update(
        used_at=timezone.now()
    )
