"""Structured logs: one JSON object per line, tagged with the request's ID.

``RequestIDMiddleware`` stores the request ID in a context variable for the duration of the
request. ``RequestIDFilter`` copies it onto every log record, so an application log line,
the ``X-Request-ID`` response header and the audit-log row for the same request share one
ID. ``JsonFormatter`` renders records as JSON (``LOG_FORMAT=json``), which log pipelines
(Loki, CloudWatch, Elastic) index without parsing rules. Exceptions keep their traceback in
an ``exc_info`` field, and newlines never split a record across lines.
"""

from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_var: ContextVar[str] = ContextVar("request_id", default="")

# Attributes every LogRecord has; anything else was passed via ``extra=`` and is kept.
_STANDARD = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime", "request_id"}


class RequestIDFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", "")
        if request_id:
            entry["request_id"] = request_id
        for key, value in record.__dict__.items():
            if key not in _STANDARD and not key.startswith("_"):
                entry[key] = (
                    value if isinstance(value, str | int | float | bool | None) else str(value)
                )
        if record.exc_info:
            entry["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)
