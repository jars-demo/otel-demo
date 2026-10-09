# 07 · Build Telemetry Pipelines

> ⏱ 20 minutes · Change the pipeline: enrich traces, drop metrics you do not need, verify both.

## Goal

Edit the Collector configuration twice: add an attribute to every span, and drop two metrics
nobody uses. Validate, restart only the Collector, and prove each change worked in the backends.

## What you'll learn

- Adding processors to one pipeline without touching the others
- The `resource` processor (enrich) and the `filter` processor (drop)
- The safe change loop: edit, validate, restart one container, verify, roll back if needed
- How a pipeline change controls cost without an application release

## Architecture

```text
traces:   otlp ─► memory_limiter ─► attributes/scrub ─► resource/collector ─► batch ─► tempo
metrics:  otlp ─► memory_limiter ─► filter/drop-size-metrics ─► batch ─► prometheus
                                     ^ new                     
```

## Prerequisites

Chapter 06. The lab is running. Have an editor open on `infra/otel/collector.yaml`.

## Steps

### 1. Enrich every span

Add this processor under `processors:` (above `batch`):

```yaml
  resource/collector:
    attributes:
      - key: lab.collector
        value: local-gateway
        action: upsert
```

and use it in the traces pipeline, **before** `batch`:

```yaml
    traces:
      receivers: [otlp]
      processors: [memory_limiter, attributes/scrub, resource/collector, batch]
      exporters: [otlp_grpc/tempo, debug]
```

> [!TIP]
> The `resource` processor changes **resource** attributes (who sent it). The `attributes`
> processor changes **span, log or metric point** attributes. Production gateways use this to
> stamp the cluster, region or Collector tier on everything that passes through.

### 2. Drop metrics you do not use

The FastAPI instrumentation also records `http.server.request.body.size` and
`http.server.response.body.size`. Nothing in this lab reads them. Add:

```yaml
  filter/drop-size-metrics:
    error_mode: ignore
    metrics:
      metric:
        - 'name == "http.server.request.body.size" or name == "http.server.response.body.size"'
```

and put it in the metrics pipeline:

```yaml
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, filter/drop-size-metrics, batch]
      exporters: [otlp_http/prometheus, debug]
```

The condition is written in **OTTL**, the OpenTelemetry Transformation Language, which the
`filter` and `transform` processors share.

### 3. Validate, then restart only the Collector

```bash
docker compose run --rm --no-deps otel-collector validate --config=/etc/otelcol-contrib/config.yaml
docker compose up -d --force-recreate otel-collector
```

> **What it does:** Checks the edited file, then recreates just the Collector container so it
> loads the new configuration. The services keep running and retry their exports during the
> few seconds the Collector is down.
> **Why:** Never restart a Collector on a configuration you have not validated.
> **Expected:** No output from `validate`, then `Container otel-demo-otel-collector-1 Started`.

### 4. Verify the enrichment

```bash
TRACE=$(curl -s -D - -o /dev/null localhost:8400/api/products | tr -d '\r' | grep -i x-trace-id | cut -d' ' -f2)
sleep 8
curl -s localhost:8410/lab/traces/$TRACE | grep -o '"lab.collector":"[a-z-]*"' | head -1
```

> **What it does:** Makes one request, keeps its trace id, waits for the spans to arrive, and
> looks for the new attribute.
> **Why:** A change you have not observed is a change you have not made.
> **Expected:** `"lab.collector":"local-gateway"`.

### 5. Verify the drop

Start some traffic from the Incident Lab (or the chapter 04 load command), wait 45 seconds, then:

```bash
curl -s -G localhost:9090/api/v1/query \
  --data-urlencode 'query=count(rate(http_server_request_body_size_bytes_count[30s]) > 0)'
curl -s -G localhost:9090/api/v1/query \
  --data-urlencode 'query=count(rate(http_server_request_duration_seconds_count[30s]) > 0)'
```

> **What it does:** Counts series that still receive new samples, for the dropped metric and for
> one that should be untouched.
> **Why:** Confirms the filter removed exactly what you meant, and nothing else.
> **Expected:** An empty `result` for the body-size metric; a count (8 in our run) for the duration
> metric.

### 6. Roll back

```bash
git checkout infra/otel/collector.yaml
docker compose up -d --force-recreate otel-collector
```

> **What it does:** Restores the original configuration and reloads it.
> **Why:** The rest of the workshop expects the original pipeline. Keeping configuration in Git
> is what makes a rollback this easy.
> **Expected:** The Collector restarts on the original file.

## Code

The full list of processors the contrib distribution ships is long. The ones worth knowing first:

| Processor | Use |
|---|---|
| `memory_limiter` | Refuse data before running out of memory |
| `batch` | Fewer, larger exports |
| `attributes`, `resource` | Add, change or delete attributes |
| `filter` | Drop spans, metrics or logs by condition (OTTL) |
| `transform` | Rewrite telemetry with OTTL statements |
| `redaction` | Mask values matching patterns |
| `tail_sampling`, `probabilistic_sampler` | Sampling (chapter 12) |

## Verification

- `lab.collector` appeared on new traces, and disappeared after the rollback
- The body-size metrics stopped receiving samples while the duration metric kept going
- `validate` passed before every restart

## Why it matters

The Collector lets you change what telemetry *is*, centrally, without redeploying services: add
context, remove waste, protect data. That is how platform teams control cost and quality across
hundreds of services.

## Common mistakes

- **Putting a processor after `batch`.** It still works, but processes bigger chunks later than
  needed; filtering and sampling belong before batching.
- **Restarting with an invalid configuration.** The Collector exits and every service's telemetry
  is dropped until you fix it.
- **Filtering on the Prometheus name.** The Collector sees OTLP names
  (`http.server.request.body.size`), not `http_server_request_body_size_bytes`.
- **Dropping data you need later.** Removing a metric is easy; recovering history is impossible.

## Challenge

Add a processor to the **logs** pipeline that drops every log record with severity below WARNING.
Validate, restart, and confirm in the Log Explorer that INFO lines stop arriving while ERROR lines
still do. Then decide: is that a good idea for this lab? Roll it back.

Next: [08 · Break the System](08-fault-injection.md)
