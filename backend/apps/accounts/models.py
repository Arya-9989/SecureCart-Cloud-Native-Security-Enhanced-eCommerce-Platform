from __future__ import annotations

from typing import Any, ClassVar

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    CUSTOMER = "customer", "Customer"
    ADMIN = "admin", "Admin"


class UserManager(BaseUserManager["User"]):
    use_in_migrations = True

    def create_user(self, email: str, password: str | None = None, **extra: Any) -> User:
        if not email:
            raise ValueError("Users must have an email address.")
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email: str, password: str | None = None, **extra: Any) -> User:
        extra.setdefault("role", Role.ADMIN)
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    """Email-addressed user with a single application role used for RBAC.

    Authorization decisions are always made against ``role`` loaded from the database on
    each request, never from token claims, so demoting or deactivating an account takes
    effect immediately.
    """

    email = models.EmailField(unique=True, max_length=254)
    full_name = models.CharField(max_length=150)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.CUSTOMER)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    # Every token carries the epoch it was issued in; bumping it ends every session at once,
    # including access tokens that have not expired yet (see apps.accounts.authentication).
    session_epoch = models.PositiveIntegerField(default=0)

    objects: ClassVar[UserManager] = UserManager()

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS: ClassVar[list[str]] = ["full_name"]

    class Meta:
        ordering = ["-date_joined"]
        indexes = [models.Index(fields=["role"])]

    def __str__(self) -> str:
        return self.email

    @property
    def is_admin(self) -> bool:
        return self.role == Role.ADMIN

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None


class TokenPurpose(models.TextChoices):
    VERIFY_EMAIL = "verify_email", "Verify email"
    RESET_PASSWORD = "reset_password", "Reset password"


class OneTimeToken(models.Model):
    """A single-use secret sent by email (verification or password reset).

    Only the SHA-256 of the secret is stored, so a database leak yields nothing usable: the
    secret itself has 256 bits of entropy and exists only in the email. ``email`` snapshots
    the address the link was sent to, so a link cannot outlive an address change.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="one_time_tokens")
    purpose = models.CharField(max_length=20, choices=TokenPurpose.choices)
    token_hash = models.CharField(max_length=64, unique=True)
    email = models.EmailField(max_length=254)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["user", "purpose"]), models.Index(fields=["expires_at"])]

    def __str__(self) -> str:
        return f"{self.purpose} for {self.email}"
