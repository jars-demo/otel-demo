# 12 · Sampling and Cost

> ⏱ 20 minutes · Turn on tail sampling in the real Collector, measure what it keeps, and learn what telemetry costs.

## Goal

Run the lab with tail sampling, prove that it keeps every error while dropping most normal traces,
and understand the other levers on telemetry cost: cardinality, retention, batching and log volume.

## What you'll learn

- Why sampling exists, and what head and tail sampling each decide
- Configuring the `tail_sampling` processor and measuring its decisions
- Why metrics are not sampled
- Cardinality, and why ids never go on metrics
- The cost drivers of an observability system

## Architecture

```text
services ─► Collector: memory_limiter ─► attributes/scrub ─► tail_sampling ─► batch ─► Tempo
                                                          │ waits 10 s per trace, then keeps it if
                                                          │ ERROR, or slower than 1 s, or in the 10%
```

## Prerequisites

Chapters 06 and 07. No fault active.

## Why sample?

A busy system produces far more traces than anyone will read. In this lab one checkout is about 25
spans; at 1000 checkouts per second that is 25,000 spans per second, over two billion a day, all
transmitted, stored and indexed. Most are identical, healthy requests. Sampling keeps a
representative share, plus the ones that matter.

- **Head sampling** decides when the trace starts, usually in the SDK (`TraceIdRatioBased`,
  wrapped in `ParentBased` so downstream services follow the decision). Cheap, but it cannot know
  yet whether the request will fail.
- **Tail sampling** decides after the trace is complete, in a Collector. It can keep errors and
  slow traces. It holds whole traces in memory while it waits.

The [Collector page](https://otel.jishanahmed.in/collector/) has a labelled simulation of both. Here
you measure the real thing.

## Steps

### 1. Switch the Collector to tail sampling

`infra/otel/collector-sampling.yaml` is the normal configuration plus one processor:

```yaml
  tail_sampling:
    decision_wait: 10s
    num_traces: 20000
    expected_new_traces_per_sec: 50
    policies:
      - name: keep-errors
        type: status_code
        status_code:
          status_codes: [ERROR]
      - name: keep-slow
        type: latency
        latency:
          threshold_ms: 1000
      - name: sample-the-rest
        type: probabilistic
        probabilistic:
          sampling_percentage: 10
```

A trace is kept if **any** policy says so.

```bash
docker compose -f docker-compose.yml -f infra/otel/sampling.compose.yaml up -d otel-collector
```

> **What it does:** Applies a Compose override that mounts the sampling configuration, and
> recreates only the Collector.
> **Why:** Same lab, one changed pipeline, so any difference is the sampler's.
> **Expected:** `Container otel-demo-otel-collector-1 Started`.

### 2. Traffic with some errors

```bash
curl -s -X PUT localhost:8410/lab/faults -H 'Content-Type: application/json' \
  -d '{"changes":{"gateway.error_rate_percent":10}}' > /dev/null
curl -s -X POST localhost:8410/lab/load -H 'Content-Type: application/json' \
  -d '{"scenario":"mixed","rps":8,"duration_s":120}' > /dev/null
```

> **What it does:** Makes the gateway reject 10% of requests with 503, and sends 8 requests per
> second for two minutes.
> **Why:** A realistic mix: mostly healthy traffic with a few errors you would want to keep.
> **Expected:** No output. Wait about 100 seconds.

### 3. Measure what was kept

```bash
curl -s -G localhost:9090/api/v1/query --data-urlencode \
  'query=sum(rate(otelcol_exporter_sent_spans{exporter="otlp_grpc/tempo"}[1m])) / sum(rate(otelcol_receiver_accepted_spans[1m]))'
```

> **What it does:** Divides spans sent to Tempo by spans received from the services.
> **Why:** That ratio is your storage saving.
> **Expected:** About 0.14 in our run: 14% of spans stored. Not 10%, because errors are always
> kept on top of the 10% sample.

```bash
curl -s -G localhost:9090/api/v1/query --data-urlencode \
  'query=sum by (policy, sampled) (increase(otelcol_processor_tail_sampling_count_traces_sampled[2m]))'
```

> **What it does:** Counts the sampler's decisions per policy over the last two minutes.
> **Why:** Shows *why* traces were kept.
> **Expected:** In our run `keep-errors` sampled 74 traces (the 503s), `sample-the-rest` 84, and
> each policy said no to roughly 650 to 740 traces.

Now open the Trace Explorer with **Errors only**: every recent error trace is there. Without the
filter, most healthy traces are missing. That is the trade-off working as intended.

### 4. Switch back

```bash
curl -s -X POST localhost:8410/lab/faults/reset > /dev/null
docker compose up -d otel-collector
```

> **What it does:** Clears the fault and recreates the Collector with the default configuration
> (no override file).
> **Why:** The rest of the workshop keeps every trace.
> **Expected:** `Container otel-demo-otel-collector-1 Started`.

## Code

Why the services' metrics are unaffected: metrics are aggregated **in the SDK** before export.
A counter sends one number per series per interval whether it counted 10 requests or 10 million.
That is why RED metrics come from the SDK's `http.server.request.duration` histogram and stay
exact while traces are sampled.

## Cardinality

```text
orders_checkouts_total{app_checkout_outcome="completed"}   5 possible outcomes: 5 series
orders_checkouts_total{app_order_id="ord_47cad529..."}     one series per order: unbounded
```

Each distinct combination of label values is a separate time series the backend stores and
indexes. Bounded labels (method, route, status code, outcome) are fine. Unbounded ones (user,
email, order id, request id, full URL) belong on spans and logs, which store each event once. This
lab puts `app.order.id` on spans and in logs, and never on a metric.

## Cost levers

| Lever | In this lab | Effect |
|---|---|---|
| Sampling | Off by default; tail sampling in this chapter | Fewer stored traces |
| Batching | `batch` processor, SDK batch processors | Fewer, larger, compressed exports |
| Filtering | Chapter 07 dropped two unused metrics | Less stored |
| Retention | 72 h in Tempo and Loki, 3 d in Prometheus | Bounded storage |
| Cardinality | Bounded metric labels only | Bounded series |
| Log volume | INFO, access logs off, no request bodies | Fewer, smaller lines |
| Export interval | 5 s for a responsive lab (default 60 s) | More points per series |

## Verification

- With sampling on, about 14% of spans reached Tempo, and every error trace was kept
- The sampler's own metrics showed the decision per policy
- After switching back, every trace is stored again

## Why it matters

Observability is not free. Telemetry volume, retention and cardinality are engineering decisions
with a cost, and the observability system has to be designed and run like any other production
system.

## Common mistakes

- **Tail sampling across several Collectors without trace-aware load balancing.** Each one sees
  half a trace and decides differently.
- **A `decision_wait` shorter than your slowest requests.** The trace is decided before its last
  spans arrive (`sampling_trace_dropped_too_early`).
- **Computing request rates from sampled spans** without accounting for the sample rate.
- **Sampling logs and metrics like traces.** Metrics are aggregated; logs need their own policy.

## Challenge

Change `sample-the-rest` to 1%, switch to the sampling configuration again, and repeat step 3.
Then run INC-001: can you still investigate it with sampling on? Which policy keeps the traces you
need, and what would happen with head sampling at 1% instead?

Next: [13 · Docker Deployment](13-docker.md)
