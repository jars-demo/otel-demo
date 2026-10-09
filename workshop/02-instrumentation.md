# 02 · Instrument Your Application

> ⏱ 20 minutes · Send your own trace to the Collector, then read how the services are instrumented.

## Goal

Understand the three pieces every instrumented service has (a resource, providers with exporters,
and instrumentation) by sending your own trace, then find the same pieces in the shop's code.

## What you'll learn

- How the OpenTelemetry SDK is set up: Resource, TracerProvider, span processor, OTLP exporter
- Automatic (library) instrumentation vs manual spans, and when to use each
- Why the services opt into the stable semantic conventions
- Why telemetry must be flushed before a process exits

## Architecture

```text
your code ─► OTel API ─► SDK (TracerProvider ─► BatchSpanProcessor ─► OTLPSpanExporter)
                                                                   │ OTLP/HTTP :4318
                                                                   ▼
                                                           otel-collector ─► Tempo
```

## Prerequisites

The lab is running (chapter 01). For step 1 you need either [uv](https://docs.astral.sh/uv/) or
just Docker.

## Steps

### 1. Send your first trace

`examples/first_span.py` sets up the SDK by hand and creates three spans:

```python
resource = Resource.create({"service.name": "first-span", "service.namespace": "otel-lab"})

provider = TracerProvider(resource=resource)
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("workshop.first_span")
with tracer.start_as_current_span("make-coffee") as parent:
    parent.set_attribute("app.coffee.size", "large")
    with tracer.start_as_current_span("grind-beans"):
        time.sleep(0.12)
    with tracer.start_as_current_span("brew") as brew:
        time.sleep(0.30)
        brew.add_event("water boiled", {"app.water.temperature_c": 94})
    trace_id = format(parent.get_span_context().trace_id, "032x")

provider.shutdown()
```

Run it with uv:

```bash
uv sync
uv run python examples/first_span.py
```

or, without Python on your machine, inside the lab's own image:

```bash
docker run --rm --network otel-demo_default \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
  -v "$PWD/examples:/examples:ro" \
  otel-demo-service:local python /examples/first_span.py
```

> **What it does:** Creates a trace with a parent span and two children, exports it over OTLP/HTTP
> to the Collector, and prints the trace id. uv uses the default endpoint `localhost:4318`; the
> Docker variant points at the Collector by its name on the lab's network.
> **Why:** The smallest complete example of the SDK, with nothing else in the way.
> **Expected:** One line, for example `trace_id: f61393485a7eb360d33a883a1689876c`.

Open `http://localhost:3400/traces/?id=<that id>`:

```text
make-coffee   421 ms
├── grind-beans   120 ms
└── brew          300 ms    event: water boiled
```

### 2. Find the same three pieces in the services

Every service calls `setup_telemetry()` from `services/common/telemetry.py` before it starts. It
does what your script did, for all three signals:

```python
resource = build_resource(service_name, service_version)  # service.name, version, environment

tracer_provider = TracerProvider(resource=resource)
tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(tracer_provider)

reader = PeriodicExportingMetricReader(OTLPMetricExporter(), export_interval_millis=5000)
metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[reader], views=DURATION_VIEWS))

logger_provider = LoggerProvider(resource=resource)
logger_provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))
set_logger_provider(logger_provider)
logging.getLogger().addHandler(LoggingHandler(logger_provider=logger_provider))

instrument_libraries()
```

The exporters read the standard environment variables, so no endpoint is hard-coded. In
`docker-compose.yml` every service gets:

```yaml
OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
OTEL_METRIC_EXPORT_INTERVAL: "5000"
OTEL_SEMCONV_STABILITY_OPT_IN: http,database
```

### 3. Automatic instrumentation

```python
HTTPXClientInstrumentor().instrument()   # every outgoing HTTP call: CLIENT span + traceparent
RedisInstrumentor().instrument()         # every Redis command: CLIENT span
PsycopgInstrumentor().instrument()       # every SQL statement: CLIENT span
FastAPIInstrumentor.instrument_app(app, excluded_urls="/health,/ready,/internal",
                                   exclude_spans=["receive", "send"])   # SERVER span per request
```

These **instrumentation libraries** wrap the frameworks you already use. You get a span for every
request handled, call made, Redis command and SQL statement, with standard attributes, without
touching business code. `excluded_urls` keeps health probes and lab controls out of the traces.

> [!NOTE]
> There is also **zero-code** instrumentation: the `opentelemetry-instrument` launcher discovers
> installed instrumentation libraries and configures the SDK from environment variables. This lab
> sets the SDK up in code instead, so you can read every step.

### 4. Manual instrumentation

Library spans show *what was called*. They cannot know *why*. Manual spans name the business
operation. From `services/inventory/main.py`:

```python
with tracer.start_as_current_span("inventory.reserve") as span:
    span.set_attribute("app.order.id", body.order_id)
    span.set_attribute("app.order.line_count", len(lines))
    ...
    await state["store"].reserve(body.order_id, lines)   # the Redis span becomes a child
    span.set_attribute("app.reservation.outcome", "reserved")
```

The checkout workflow in `services/orders/checkout.py` has one manual span per step:
`order.validate`, `order.create`, `order.reserve_inventory`, `order.charge_payment`,
`order.complete`. That is the level to aim for: meaningful operations, not a span around every
line.

### 5. The semantic-convention opt-in

```bash
curl -s localhost:8410/lab/traces/<trace id from chapter 01> | grep -o '"db.system.name":"[a-z]*"' | sort -u
```

> **What it does:** Fetches the checkout trace and lists the database systems its spans name.
> **Why:** To see the stable attribute names (`db.system.name`) in real data.
> **Expected:** `"db.system.name":"postgresql"` and `"db.system.name":"redis"`.

The instrumentation libraries still emit the old names (`db.system`, `http.method`) by default.
`OTEL_SEMCONV_STABILITY_OPT_IN=http,database` switches them to the stable conventions.

## Verification

- Your `first-span` trace opens in the Trace Explorer with three spans and one event
- You can point at the Resource, the provider, the processor and the exporter in
  `services/common/telemetry.py`
- You can name one library span and one manual span from a checkout trace

## Why it matters

The SDK setup is the same in every language: identify the service, choose processors and
exporters, instrument. Library instrumentation gives breadth for free; a few well-named manual
spans give meaning. Together they make a trace readable.

## Common mistakes

- **Forgetting to flush.** `BatchSpanProcessor` exports every few seconds. A short script that
  exits without `provider.shutdown()` loses its spans.
- **Instrumenting after creating clients.** Some instrumentors patch classes; set them up before
  the clients you want traced are created.
- **A span around every function.** Noise hides the signal and costs money. Name business
  operations.
- **No `service.name`.** Telemetry shows up as `unknown_service` and cannot be filtered.

## Challenge

Change `first_span.py` so that `brew` fails: raise an exception inside it. Run it again. What does
the `brew` span show (status, events)? Does `make-coffee` change too? Chapter 03 explains why.

Next: [03 · Understand Traces](03-traces.md)
