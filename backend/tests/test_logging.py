"""Structured JSON logs correlated with request IDs."""

from __future__ import annotations

import importlib
import io
import json
import logging
from collections.abc import Iterator
from unittest import mock

import pytest
from django.core.exceptions import ImproperlyConfigured
from rest_framework.test import APIClient

import config.settings as settings_module
from apps.accounts.models import User
from apps.core.logging import JsonFormatter, RequestIDFilter, request_id_var
from tests.conftest import PASSWORD


@pytest.fixture
def audit_lines() -> Iterator[io.StringIO]:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(RequestIDFilter())
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("securecart.audit")
    logger.addHandler(handler)
    previous = logger.level
    logger.setLevel(logging.INFO)
    yield stream
    logger.removeHandler(handler)
    logger.setLevel(previous)


def record(message: str, **extra: object) -> logging.LogRecord:
    return logging.makeLogRecord(
        {"name": "securecart.test", "levelname": "INFO", "msg": message, **extra}
    )


class TestFormatter:
    def test_one_json_object_per_line(self) -> None:
        line = JsonFormatter().format(record("first line\nsecond line"))
        assert "\n" not in line
        data = json.loads(line)
        assert data["message"] == "first line\nsecond line"
        assert data["level"] == "INFO"
        assert data["logger"] == "securecart.test"
        assert data["ts"].endswith("+00:00")

    def test_extra_fields_are_kept_and_made_json_safe(self) -> None:
        data = json.loads(JsonFormatter().format(record("x", order="SC-1", amount=object())))
        assert data["order"] == "SC-1"
        assert isinstance(data["amount"], str)

    def test_exceptions_keep_their_traceback(self) -> None:
        try:
            raise ValueError("boom")
        except ValueError:
            import sys  # noqa: PLC0415

            line = JsonFormatter().format(record("failed", exc_info=sys.exc_info()))
        assert "ValueError: boom" in json.loads(line)["exc_info"]

    def test_request_id_comes_from_the_context(self) -> None:
        token = request_id_var.set("req-12345678")
        try:
            entry = record("x")
            RequestIDFilter().filter(entry)
        finally:
            request_id_var.reset(token)
        assert json.loads(JsonFormatter().format(entry))["request_id"] == "req-12345678"


@pytest.mark.django_db
class TestCorrelation:
    def test_log_lines_carry_the_request_id_of_their_request(
        self, customer: User, audit_lines: io.StringIO
    ) -> None:
        response = APIClient().post(
            "/api/auth/login/",
            {"email": customer.email, "password": PASSWORD},
            HTTP_X_REQUEST_ID="trace-abc-12345",
        )
        assert response["X-Request-ID"] == "trace-abc-12345"
        lines = [json.loads(line) for line in audit_lines.getvalue().splitlines()]
        assert lines
        assert {line["request_id"] for line in lines} == {"trace-abc-12345"}
        assert request_id_var.get() == ""  # nothing leaks past the request

    def test_untrusted_request_ids_are_replaced(
        self, customer: User, audit_lines: io.StringIO
    ) -> None:
        response = APIClient().post(
            "/api/auth/login/",
            {"email": customer.email, "password": PASSWORD},
            HTTP_X_REQUEST_ID='"><script>',
        )
        generated = response["X-Request-ID"]
        assert generated != '"><script>'
        assert json.loads(audit_lines.getvalue().splitlines()[0])["request_id"] == generated


class TestSettings:
    def test_json_is_the_default_outside_debug(self) -> None:
        assert settings_module.LOG_FORMAT == "json"

    def test_unknown_format_is_refused(self) -> None:
        try:
            with (
                mock.patch.dict("os.environ", {"LOG_FORMAT": "xml"}),
                pytest.raises(ImproperlyConfigured),
            ):
                importlib.reload(settings_module)
        finally:
            importlib.reload(settings_module)
