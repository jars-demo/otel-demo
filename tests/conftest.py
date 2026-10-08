"""Shared fixtures. Telemetry goes to in-memory exporters, so tests can assert on real spans,
metrics and log records produced by the real instrumentation, without a Collector."""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

os.environ.setdefault("OTEL_SEMCONV_STABILITY_OPT_IN", "http,database")

import httpx
import pytest
from opentelemetry import metrics, trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.logging.handler import LoggingHandler
from opentelemetry.sdk._logs import LoggerProvider
from opentelemetry.sdk._logs.export import InMemoryLogRecordExporter, SimpleLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from common.telemetry import DURATION_VIEWS, build_resource, instrument_libraries

# Global providers can only be set once per process: do it at import time, before any service
# module creates its tracer or meter.
SPANS = InMemorySpanExporter()
METRICS = InMemoryMetricReader()
LOGS = InMemoryLogRecordExporter()

_resource = build_resource("test-service", "0.0.0")
_tracer_provider = TracerProvider(resource=_resource)
_tracer_provider.add_span_processor(SimpleSpanProcessor(SPANS))
trace.set_tracer_provider(_tracer_provider)
metrics.set_meter_provider(
    MeterProvider(resource=_resource, metric_readers=[METRICS], views=DURATION_VIEWS)
)
_logger_provider = LoggerProvider(resource=_resource)
_logger_provider.add_log_record_processor(SimpleLogRecordProcessor(LOGS))
set_logger_provider(_logger_provider)
logging.getLogger().addHandler(LoggingHandler(logger_provider=_logger_provider))
instrument_libraries()


@pytest.fixture
def spans():
    SPANS.clear()
    yield SPANS
    SPANS.clear()


@pytest.fixture
def log_records():
    LOGS.clear()
    yield LOGS
    LOGS.clear()


def mock_client(base_url: str, handler) -> httpx.AsyncClient:
    """An httpx client answered by `handler`. The instrumentation wraps real transports, so a
    MockTransport client is instrumented explicitly: requests then carry traceparent."""
    client = httpx.AsyncClient(base_url=base_url, transport=httpx.MockTransport(handler))
    HTTPXClientInstrumentor.instrument_client(client)
    return client


def metric_points(name: str) -> list:
    """All data points of one metric from the in-memory reader."""
    data = METRICS.get_metrics_data()
    points = []
    for resource_metrics in data.resource_metrics if data else []:
        for scope_metrics in resource_metrics.scope_metrics:
            for metric in scope_metrics.metrics:
                if metric.name == name:
                    points.extend(metric.data.data_points)
    return points


# --- A tiny stand-in for PostgreSQL -------------------------------------------------------------


class FakeCursor:
    def __init__(self, db: FakeDatabase) -> None:
        self.db = db

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def executemany(self, query: str, rows) -> None:
        for row in rows:
            self.db.statements.append((query, row))

    async def execute(self, query: str, params=None) -> None:
        self.db.statements.append((query, params))

    async def fetchone(self):
        return None

    async def fetchall(self):
        return []


class FakeConnection:
    def __init__(self, db: FakeDatabase) -> None:
        self.db = db

    async def execute(self, query: str, params=None) -> None:
        self.db.statements.append((query, params))

    def cursor(self, **_):
        return FakeCursor(self.db)

    @asynccontextmanager
    async def transaction(self):
        yield


class FakeDatabase:
    """Implements the parts of common.db.Database the services use, and records statements."""

    def __init__(self) -> None:
        self.statements: list[tuple[str, object]] = []
        self.max_size = 10

    async def open(self) -> None: ...

    async def close(self) -> None: ...

    async def ping(self) -> None: ...

    async def resize(self, max_size: int) -> None:
        self.max_size = max_size

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[FakeConnection]:
        yield FakeConnection(self)

    def statuses(self) -> list[str]:
        return [p[0] for q, p in self.statements if q.startswith("UPDATE orders") and p]
