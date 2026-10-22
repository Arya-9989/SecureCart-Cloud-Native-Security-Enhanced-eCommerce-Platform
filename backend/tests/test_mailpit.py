"""End-to-end delivery through a real SMTP server (Mailpit), not Django's in-memory outbox.

Runs when ``MAILPIT_URL`` points at Mailpit's HTTP API (CI starts it as a service; locally,
``docker compose up mailpit``). SMTP goes to ``MAILPIT_SMTP_HOST``:``MAILPIT_SMTP_PORT``.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.request
from typing import Any

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from tests.conftest import PASSWORD

MAILPIT_URL = os.environ.get("MAILPIT_URL", "").rstrip("/")

pytestmark = [
    pytest.mark.mailpit,
    pytest.mark.django_db,
    pytest.mark.skipif(not MAILPIT_URL, reason="set MAILPIT_URL to run against Mailpit"),
]


def _api(method: str, path: str) -> Any:
    request = urllib.request.Request(f"{MAILPIT_URL}{path}", method=method)  # noqa: S310
    with urllib.request.urlopen(request, timeout=5) as response:  # noqa: S310
        body = response.read()
        is_json = response.headers.get_content_type() == "application/json"
    # DELETE answers a plain "ok".
    return json.loads(body) if is_json else None


def _wait_for(to: str, subject: str, timeout: float = 10) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for summary in _api("GET", "/api/v1/messages")["messages"]:
            if summary["Subject"] == subject and any(t["Address"] == to for t in summary["To"]):
                message: dict[str, Any] = _api("GET", f"/api/v1/message/{summary['ID']}")
                return message
        time.sleep(0.2)
    raise AssertionError(f"no message {subject!r} for {to} within {timeout}s")


@pytest.fixture(autouse=True)
def _smtp(settings: Any) -> None:
    settings.EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    settings.EMAIL_HOST = os.environ.get("MAILPIT_SMTP_HOST", "localhost")
    settings.EMAIL_PORT = int(os.environ.get("MAILPIT_SMTP_PORT", "1025"))
    settings.EMAIL_USE_TLS = False
    settings.EMAIL_USE_SSL = False
    settings.EMAIL_TIMEOUT = 5
    _api("DELETE", "/api/v1/messages")


@override_settings(EMAIL_DELIVERY="inline")
def test_reset_link_travels_through_smtp_and_works(
    customer: User, django_capture_on_commit_callbacks: Any
) -> None:
    with django_capture_on_commit_callbacks(execute=True):
        assert (
            APIClient().post("/api/auth/password/forgot/", {"email": customer.email}).status_code
            == 202
        )
    message = _wait_for(customer.email, "Reset your SecureCart password")
    assert message["From"]["Address"] == "no-reply@securecart.dev"
    assert message["HTML"], "multipart message with an HTML part"
    token = re.search(r"#token=([A-Za-z0-9_\-]+)", message["Text"])
    assert token

    new_password = "Mailpit-Delivered-91!"
    with django_capture_on_commit_callbacks(execute=True):
        response = APIClient().post(
            "/api/auth/password/reset/", {"token": token.group(1), "new_password": new_password}
        )
    assert response.status_code == 200
    customer.refresh_from_db()
    assert customer.check_password(new_password)
    assert not customer.check_password(PASSWORD)
    _wait_for(customer.email, "Your SecureCart password was changed")


@override_settings(EMAIL_DELIVERY="background")
def test_background_delivery_reaches_the_server(
    make_user: Any, django_capture_on_commit_callbacks: Any
) -> None:
    with django_capture_on_commit_callbacks(execute=True):
        response = APIClient().post(
            "/api/auth/register/",
            {"email": "inbox@example.com", "full_name": "Inbox Owner", "password": PASSWORD},
        )
    assert response.status_code == 201
    message = _wait_for("inbox@example.com", "Confirm your email for SecureCart")
    assert "/verify-email#token=" in message["Text"]
