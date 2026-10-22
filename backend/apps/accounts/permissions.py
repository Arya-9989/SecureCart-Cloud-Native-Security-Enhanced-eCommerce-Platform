from __future__ import annotations

from typing import Any

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from apps.accounts.models import Role


class IsAdminRole(BasePermission):
    """Grants access only to active, authenticated users holding the ``admin`` role."""

    message = "Administrator role required."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user: Any = request.user
        return bool(user and user.is_authenticated and user.is_active and user.role == Role.ADMIN)
