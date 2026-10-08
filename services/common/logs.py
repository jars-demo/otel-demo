"""Structured logging: one JSON object per line on stdout, with trace correlation fields.

Two copies of every log record leave the process:

1. stdout, as JSON (this module), for `docker compose logs` and for humans.
2. OTLP, through the OTel LoggingHandler installed in `common.telemetry`, to the Collector and
   then Loki. That copy carries trace_id and span_id as first-class fields.

Both copies come from the same `logging` call, so they always agree. Pass context with `extra`:

    log.info("order created", extra={"app.order.id": order_id})

Never log passwords, tokens, API keys, payment details or unnecessary personal data.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import UTC, datetime

from opentelemetry import trace

# Attributes every LogRecord has; anything else on the record came from `extra=`.
_RESERVED = set(logging.makeLogRecord({}).__dict__) | {
    "message",
    "asctime",
    "taskName",
    "color_message",  # uvicorn's ANSI-colored duplicate of the message
}


class JsonFormatter(logging.Formatter):
    def __init__(self, service_name: str) -> None:
        super().__init__()
        self.service_name = service_name

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(
                timespec="milliseconds"
            ),
            "severity": record.levelname,
            "service.name": self.service_name,
            "logger": record.name,
            "message": record.getMessage(),
        }
        span_context = trace.get_current_span().get_span_context()
        if span_context.is_valid:
            entry["trace_id"] = format(span_context.trace_id, "032x")
            entry["span_id"] = format(span_context.span_id, "016x")
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                entry[key] = value
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def setup_logging(service_name: str) -> None:
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter(service_name))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # Access logs duplicate the HTTP spans and metrics; keep stdout readable.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
