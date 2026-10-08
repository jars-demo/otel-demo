"""OpenTelemetry SDK setup, done once per process before the app starts.

Every service calls `setup_telemetry()` from its entry point. It builds a Resource (who is
emitting), then one provider per signal (traces, metrics, logs), each exporting OTLP/HTTP to the
Collector. Nothing here talks to Tempo, Prometheus or Loki directly: that is the Collector's job.

Configuration comes from the standard OTEL_* environment variables, so the same code runs in
Docker (endpoint http://otel-collector:4318) and on your machine (http://localhost:4318):

    OTEL_EXPORTER_OTLP_ENDPOINT   where the Collector listens (OTLP/HTTP)
    OTEL_RESOURCE_ATTRIBUTES      extra resource attributes, e.g. deployment.environment.name=demo
    OTEL_SDK_DISABLED=true        turn telemetry off entirely (the tests use in-memory exporters)
"""

from __future__ import annotations

import logging
import os
import socket

from opentelemetry import metrics, trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.psycopg import PsycopgInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.semconv._incubating.attributes.deployment_attributes import (
    DEPLOYMENT_ENVIRONMENT_NAME,
)
from opentelemetry.semconv.attributes.service_attributes import (
    SERVICE_INSTANCE_ID,
    SERVICE_NAME,
    SERVICE_NAMESPACE,
    SERVICE_VERSION,
)

SERVICE_NAMESPACE_VALUE = "otel-lab"

# Emit the stable HTTP and database semantic conventions (http.request.method,
# db.system.name, db.query.text, ...) instead of the old pre-1.0 names (http.method,
# db.system, db.statement). The instrumentation libraries still default to the old names for
# compatibility; this opt-in is documented in each library. Set before instrumenting.
os.environ.setdefault("OTEL_SEMCONV_STABILITY_OPT_IN", "http,database")

# The demo exports metrics every 5 s so charts move while you watch. The SDK default is 60 s,
# which is a sensible production value: fewer, larger exports.
METRIC_EXPORT_INTERVAL_MS = int(os.getenv("OTEL_METRIC_EXPORT_INTERVAL", "5000"))


def build_resource(service_name: str, service_version: str) -> Resource:
    """Who is emitting this telemetry. Attached to every span, metric and log record."""
    return Resource.create(
        {
            SERVICE_NAME: service_name,
            SERVICE_VERSION: service_version,
            SERVICE_NAMESPACE: SERVICE_NAMESPACE_VALUE,
            # In Docker the hostname is the container ID: unique per running instance.
            SERVICE_INSTANCE_ID: socket.gethostname(),
            DEPLOYMENT_ENVIRONMENT_NAME: os.getenv("DEPLOYMENT_ENVIRONMENT", "demo"),
        }
        # Resource.create() also merges OTEL_RESOURCE_ATTRIBUTES; those values win.
    )


def telemetry_disabled() -> bool:
    return os.getenv("OTEL_SDK_DISABLED", "false").lower() == "true"


def setup_telemetry(service_name: str, service_version: str) -> None:
    """Install the global tracer, meter and logger providers, then instrument libraries."""
    if telemetry_disabled():
        return
    resource = build_resource(service_name, service_version)

    # Traces: spans are buffered and exported in batches (BatchSpanProcessor), never one by one.
    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(tracer_provider)

    # Metrics: instruments aggregate in memory; a reader exports a snapshot on an interval.
    reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(), export_interval_millis=METRIC_EXPORT_INTERVAL_MS
    )
    metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[reader]))

    # Logs (the Python logs SDK is still marked experimental: note the underscore modules).
    # A LoggingHandler turns stdlib `logging` records into OTel log records. Records emitted
    # inside a span carry its trace_id and span_id: that is what makes log/trace correlation work.
    logger_provider = LoggerProvider(resource=resource)
    logger_provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))
    set_logger_provider(logger_provider)
    logging.getLogger().addHandler(LoggingHandler(logger_provider=logger_provider))

    instrument_libraries()


def instrument_libraries() -> None:
    """Library instrumentation: spans for HTTP clients, Redis and PostgreSQL with no code changes.

    FastAPI is instrumented per app in `common.app.create_service_app()`.
    """
    HTTPXClientInstrumentor().instrument()
    RedisInstrumentor().instrument()
    PsycopgInstrumentor().instrument()


def shutdown_telemetry() -> None:
    """Flush buffered telemetry on shutdown so the last spans are not lost."""
    for provider in (trace.get_tracer_provider(), metrics.get_meter_provider()):
        shutdown = getattr(provider, "shutdown", None)
        if shutdown:
            shutdown()
    from opentelemetry._logs import get_logger_provider

    shutdown = getattr(get_logger_provider(), "shutdown", None)
    if shutdown:
        shutdown()
