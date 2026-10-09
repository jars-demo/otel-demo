"""Your first trace, in about 30 lines. Chapter 02 runs it against the lab's Collector:

    uv run python examples/first_span.py

It sets up the SDK by hand (the same three steps every service does in services/common/
telemetry.py), creates a parent span with two children, and prints the trace id so you can open
the trace in the Trace Explorer or Grafana.
"""

import time

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

# 1. Who is emitting: a Resource with a service name.
resource = Resource.create({"service.name": "first-span", "service.namespace": "otel-lab"})

# 2. Where spans go: OTLP over HTTP to the Collector (default endpoint http://localhost:4318).
provider = TracerProvider(resource=resource)
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)

# 3. Create spans. Nesting `with` blocks makes parent/child relationships.
tracer = trace.get_tracer("workshop.first_span")
with tracer.start_as_current_span("make-coffee") as parent:
    parent.set_attribute("app.coffee.size", "large")
    with tracer.start_as_current_span("grind-beans"):
        time.sleep(0.12)
    with tracer.start_as_current_span("brew") as brew:
        time.sleep(0.30)
        brew.add_event("water boiled", {"app.water.temperature_c": 94})
    trace_id = format(parent.get_span_context().trace_id, "032x")

# Spans are exported in batches: flush before the process exits, or they are lost.
provider.shutdown()
print(f"trace_id: {trace_id}")
