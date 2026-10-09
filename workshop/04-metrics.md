# 04 · Add Metrics

> ⏱ 20 minutes · Instruments, RED metrics, histograms, percentiles and PromQL.

## Goal

See how the services record metrics, how they reach Prometheus, and how request rate, error rate
and latency percentiles are computed from them.

## What you'll learn

- The metric instruments: counter, up-down counter, histogram, observable instruments
- RED (Rate, Errors, Duration) from the standard `http.server.request.duration` histogram
- How OTLP metric names become Prometheus names
- Why percentiles from histograms are estimates, and how Views improve them
- Business metrics with low-cardinality attributes

## Architecture

```text
service: MeterProvider ─ PeriodicExportingMetricReader (every 5 s) ─ OTLP ─► Collector
Collector: metrics pipeline ─ otlp_http/prometheus ─► Prometheus /api/v1/otlp
Prometheus: stores series, answers PromQL ─► Grafana, the Metrics page
```

## Prerequisites

The lab is running.

## Steps

### 1. Generate traffic

Metrics are about behaviour over time, so they need a steady flow of requests:

```bash
curl -s -X POST localhost:8410/lab/load \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"mixed","rps":5,"duration_s":180}'
```

> **What it does:** Starts the lab's load generator: about 5 requests per second for three
> minutes, 60% checkouts and 40% product browsing, with random (Poisson) arrival times.
> **Why:** Rates and percentiles need a population of requests.
> **Expected:** A JSON status with `"running": true`. Wait a minute before the next step.

### 2. Request rate per service

```bash
curl -s -G localhost:9090/api/v1/query \
  --data-urlencode 'query=sum by (service_name) (rate(http_server_request_duration_seconds_count[1m]))'
```

> **What it does:** Asks Prometheus how many requests per second each service handled over the
> last minute.
> **Why:** This is the **R** of RED.
> **Expected:** Four series. Roughly what the load generator sends: the gateway about 5/s,
> inventory-service more (both browsing and checkout call it), payment about 3/s.

```text
api-gateway        4.851
order-service      2.564
inventory-service  7.558
payment-service    2.744
```

Where does `http_server_request_duration_seconds_count` come from? The FastAPI instrumentation
records the standard histogram **`http.server.request.duration`** (unit `s`) for every request.
Prometheus turns OTLP names into its own convention: dots become underscores, the unit becomes a
suffix, and a histogram becomes `_bucket`, `_count` and `_sum` series. The resource attribute
`service.name` becomes the label `service_name`, because `infra/prometheus/prometheus.yaml`
promotes it.

### 3. Latency percentiles

```bash
curl -s -G localhost:9090/api/v1/query \
  --data-urlencode 'query=histogram_quantile(0.95, sum by (le, service_name) (rate(http_server_request_duration_seconds_bucket[1m])))'
```

> **What it does:** Computes the 95th percentile latency per service from the histogram buckets.
> **Why:** This is the **D** of RED. p95 means "95% of requests were faster than this".
> **Expected:** In seconds. About 0.23 s for the gateway and order-service, 0.2 s for payment
> (mostly the simulated card network), a few milliseconds for inventory.

```text
api-gateway        0.232
order-service      0.236
inventory-service  0.005
payment-service    0.196
```

> [!IMPORTANT]
> A histogram stores **counts per bucket**, not individual durations. `histogram_quantile`
> finds the bucket the 95th percentile falls in and interpolates inside it. With the SDK's
> default buckets, a real 3.4 s could be reported as anything between 2.5 s and 5 s. The
> services use a **View** to configure finer buckets (`services/common/telemetry.py`):

```python
DURATION_BUCKETS_S = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5,
                      0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 7.5, 10]
View(instrument_name="http.server.request.duration",
     aggregation=ExplicitBucketHistogramAggregation(DURATION_BUCKETS_S))
```

### 4. Business metrics

```bash
curl -s -G localhost:9090/api/v1/query \
  --data-urlencode 'query=sum by (app_checkout_outcome) (orders_checkouts_total)'
```

> **What it does:** Totals checkouts by outcome since the services started.
> **Why:** HTTP metrics tell you about requests; business metrics tell you about the business.
> **Expected:** Mostly `completed`, plus `failed` from the fault you tried in chapter 03.

```text
completed  215
failed       3
```

The counter is created once and incremented with one low-cardinality attribute
(`services/orders/checkout.py`):

```python
checkouts = meter.create_counter("orders.checkouts", unit="{checkout}",
                                 description="Checkout attempts, by outcome")
checkouts.add(1, {"app.checkout.outcome": "completed"})
```

The services also record `orders.created`, `payments.processed` and `inventory.reservations`, and
the database pool metrics `db.client.connection.*` (chapter 15 needs those).

### 5. The dashboard

Open `http://localhost:3400/metrics/`. The stat cards, service table and charts are the same
queries, refreshed every 5 seconds. Grafana (`http://localhost:3401`, Explore, Prometheus) runs
any PromQL you like.

## Code

| Instrument | Use it for | In this lab |
|---|---|---|
| Counter | Things that only increase | `orders.checkouts`, `payments.processed` |
| Histogram | Distributions | `http.server.request.duration`, `db.client.connection.wait_time` |
| Up-down counter | Values that go up and down | (observable) `db.client.connection.count` |
| Observable instruments | Values read when exported, via a callback | pool size, pending requests |

## Verification

- The rate query returns four services with non-zero values while load runs
- You can explain why `inventory-service` has a higher rate than `api-gateway`
- `orders_checkouts_total` shows outcomes as a label

## Why it matters

Metrics are cheap to keep and fast to query, so they are what you alert on and what tells you
*something changed, and since when*. RED gives every service the same three questions.

## Common mistakes

- **Averages instead of percentiles.** A 200 ms average can hide 5% of users waiting 3 s.
- **High-cardinality attributes on metrics.** `app.order.id` on a counter would create one
  series per order. Ids go on spans and logs (Concepts: Cardinality).
- **Rate windows shorter than two samples.** With a 5 s export interval, `rate(...[5s])` is
  empty. Use at least 30 s.
- **Forgetting the unit.** `http.server.request.duration` is in seconds; multiply by 1000 for ms.

## Challenge

Write a PromQL query for the **error ratio** of the gateway: 5xx requests divided by all requests
over the last minute. Turn on `gateway.error_rate_percent = 10` from the Incident Lab and check
that your query reports about 0.1.

Next: [05 · Correlate Logs](05-logs.md)
