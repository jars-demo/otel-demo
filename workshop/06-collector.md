# 06 · Meet the Collector

> ⏱ 15 minutes · Receivers, processors, exporters, pipelines, and the Collector watching itself.

## Goal

Read the lab's Collector configuration end to end, validate it, watch telemetry pass through,
and measure how much the Collector accepts and exports.

## What you'll learn

- Why a Collector sits between applications and backends
- Receivers, processors, exporters, extensions and pipelines
- How to validate a configuration without starting anything
- The Collector's own metrics: accepted, refused, sent

## Architecture

```text
              ┌────────────────────── otel-collector ──────────────────────┐
 services ──► │ receiver otlp ─► memory_limiter ─► attributes/scrub ─► batch │─► otlp_grpc/tempo
   OTLP       │             (traces pipeline)                               │─► debug
              │ receiver otlp ─► memory_limiter ─► batch                    │─► otlp_http/prometheus
              │             (metrics pipeline)                              │
              │ receiver otlp ─► memory_limiter ─► attributes/scrub ─► batch │─► otlp_http/loki
              │             (logs pipeline)                                 │
              └─────────────────────────────────────────────────────────────┘
```

The [Collector](https://otel.jishanahmed.in/collector/) page has an interactive version.

## Prerequisites

The lab is running, with some traffic (start load from the Incident Lab, or rerun the chapter 04
load command).

## Why a Collector?

The services could export straight to Tempo, Prometheus and Loki. They do not, because a Collector
in the middle means:

- services only know one protocol and one endpoint
- backends can change without redeploying any service
- policy lives in one place: memory protection, scrubbing, sampling, batching, retries
- a slow backend is buffered by the Collector, not by your application

## Steps

### 1. Read the configuration

Open `infra/otel/collector.yaml`. It has five top-level sections:

```yaml
extensions:   # things that are not in the data path: health_check on :13133
receivers:    # how data gets in: otlp on gRPC :4317 and HTTP :4318
processors:   # what happens on the way: memory_limiter, attributes/scrub, batch
exporters:    # where it goes: otlp_grpc/tempo, otlp_http/prometheus, otlp_http/loki, debug
service:      # what is actually turned on: extensions and one pipeline per signal
```

A component defined but not listed in a pipeline does nothing. Names like `otlp_http/loki` are
`type/name`: two exporters of the same type need different names.

> [!NOTE]
> Collector 0.162 names the OTLP exporters `otlp_grpc` and `otlp_http`. Older configurations
> use `otlp` and `otlphttp`; `otlphttp` still works as a deprecated alias. Check the version
> when you copy a configuration from the internet.

### 2. Validate it

```bash
docker compose run --rm --no-deps otel-collector validate --config=/etc/otelcol-contrib/config.yaml
```

> **What it does:** Starts a throwaway Collector container that parses and checks the
> configuration (component names, types, pipeline wiring), then exits.
> **Why:** A typo in a running Collector means lost telemetry. Validate before you restart.
> **Expected:** No output and exit code 0. On an error it prints which key is wrong.

### 3. Watch data pass through

```bash
docker compose logs otel-collector --tail 3 --no-log-prefix
```

> **What it does:** Shows what the `debug` exporter printed.
> **Why:** With verbosity `basic`, it writes one line per batch it exports: a cheap way to confirm
> data is flowing.
> **Expected:** Lines ending like `"otelcol.signal": "traces", "resource spans": 3, "spans": 24`.

Set `verbosity: detailed` on the `debug` exporter to print every span, metric point and log record
in full. Useful while learning, far too noisy for production.

### 4. The Collector's own metrics

```bash
curl -s -G localhost:9090/api/v1/query \
  --data-urlencode 'query=sum by (receiver, exporter) (rate(otelcol_receiver_accepted_spans[1m]) or rate(otelcol_exporter_sent_spans[1m]))'
```

> **What it does:** Spans per second accepted by the receiver, and sent by each exporter.
> **Why:** The Collector exposes metrics about itself on :8888, which Prometheus scrapes. If
> accepted is higher than sent, data is being dropped or queued.
> **Expected:** The same rate for the receiver and each traces exporter, for example:

```text
receiver otlp              86 spans/s accepted
exporter otlp_grpc/tempo   86 spans/s sent
exporter debug             86 spans/s sent
```

Also worth knowing: `otelcol_receiver_refused_spans` (the memory limiter said no),
`otelcol_exporter_queue_size` (a backend is slow), and the `_log_records` and `_metric_points`
variants.

### 5. Health

```bash
curl -s localhost:8410/lab/status | grep -o '"otel-collector":"[a-z_]*"'
```

> **What it does:** The lab-console probes the Collector's `health_check` extension on :13133.
> **Why:** The Collector image has no shell for a Docker health check, so readiness is checked
> over HTTP.
> **Expected:** `"otel-collector":"up"`.

## Code

The traces pipeline, the heart of the file:

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, attributes/scrub, batch]
      exporters: [otlp_grpc/tempo, debug]
```

Processors run **in the order listed**. `memory_limiter` first, so an overloaded Collector refuses
data before doing any work; `batch` last, so filtering and sampling happen before batching.

## Verification

- `validate` exits 0
- The debug exporter shows batches for traces, metrics and logs
- Accepted and sent rates match for traces

## Why it matters

The Collector is where an organisation's telemetry policy lives. Knowing how to read, validate and
monitor it is what makes the pipeline trustworthy. Telemetry you think you have but are silently
dropping is worse than none.

## Common mistakes

- **Defining a component but not adding it to a pipeline.** It is silently unused.
- **`batch` before `memory_limiter`.** Order matters; follow the component's documentation.
- **Copying configurations from old blog posts.** Component names and options change. Validate
  against the version you run.
- **Exposing receivers publicly without authentication.** Anyone could send you telemetry (see
  the Security page).

## Challenge

Change the `debug` exporter to `verbosity: detailed`, validate, and restart only the Collector
with `docker compose up -d otel-collector`. Place one checkout and find its spans in the Collector
logs. Which resource attributes does each batch carry? Change it back afterwards.

Next: [07 · Build Telemetry Pipelines](07-pipelines.md)
