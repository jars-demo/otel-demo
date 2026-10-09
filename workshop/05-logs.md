# 05 · Correlate Logs

> ⏱ 15 minutes · Structured logs with trace context: from a trace to its logs, and back.

## Goal

See how one `logging` call becomes a JSON line on stdout and an OTLP log record in Loki, both
carrying the trace id, and use that id to move between logs and traces.

## What you'll learn

- Structured logs vs text logs
- How log records pick up `trace_id` and `span_id`
- How Loki stores OTLP logs: labels vs structured metadata
- LogQL queries by service, severity and trace id
- What must never be logged

## Architecture

```text
log.info("order created", extra={"app.order.id": ...})
   ├─► JsonFormatter ─► stdout ─► docker compose logs
   └─► LoggingHandler (OTel) ─► LoggerProvider ─► OTLP ─► Collector ─► Loki
                                    trace_id, span_id from the active span
```

## Prerequisites

The lab is running. You have the trace id of the failed checkout from chapter 03 (or any error
trace).

## Steps

### 1. Logs on stdout

```bash
docker compose logs order-service --tail 2 --no-log-prefix
```

> **What it does:** Prints the last two log lines order-service wrote to stdout.
> **Why:** Every service logs one JSON object per line, with correlation fields.
> **Expected:** Two JSON lines with `trace_id` and `span_id`.

```json
{"timestamp": "2026-10-08T20:25:24.799+00:00", "severity": "INFO", "service.name": "order-service", "logger": "orders.checkout", "message": "order created", "trace_id": "980ab2872ab44c05c8aa2b45f7ff8f81", "span_id": "ead6bc6fccc6c3fd", "app.order.id": "ord_47cad5296e544244", "app.order.total_cents": 17800}
{"timestamp": "2026-10-08T20:25:25.144+00:00", "severity": "INFO", "service.name": "order-service", "logger": "orders.checkout", "message": "checkout completed", "trace_id": "980ab2872ab44c05c8aa2b45f7ff8f81", "span_id": "ead6bc6fccc6c3fd", "app.order.id": "ord_47cad5296e544244"}
```

### 2. The same logs in Loki

```bash
curl -s -G localhost:3100/loki/api/v1/query_range \
  --data-urlencode 'query={service_name="order-service"} | trace_id="<your trace id>"' \
  --data-urlencode 'since=1h'
```

> **What it does:** Runs a LogQL query: the stream of order-service logs, filtered to one trace.
> **Why:** In Loki, `service_name` is an indexed **label** (cheap to select by) and `trace_id` is
> **structured metadata** (stored with each line, filterable after the stream selector).
> **Expected:** A JSON result whose `stream` contains `trace_id`, `span_id`, `severity_text` and
> `app_order_id`, and whose `values` are the messages.

Loki receives OTLP and converts attribute names: `app.order.id` is stored as `app_order_id`.

### 3. Errors, across services

```bash
curl -s -G localhost:3100/loki/api/v1/query_range \
  --data-urlencode 'query={service_namespace="otel-lab"} | severity_text="ERROR"' \
  --data-urlencode 'since=1h' --data-urlencode 'limit=10'
```

> **What it does:** Every ERROR record from any lab service in the last hour.
> **Why:** During an incident, "show me the errors" is the first log query.
> **Expected:** For the chapter 03 failure, three records with the same `trace_id`:

```text
payment-service  payment provider timeout after 800 ms
order-service    payment-service returned 503: payment provider timeout after 800 ms
api-gateway      order-service returned 502: payment-service returned 503: payment provider timeout after 800 ms
```

Three services reported the same failure from their own point of view. The trace id is what tells
you these three lines are one event, not three problems.

### 4. Trace to logs, logs to trace

In the Trace Explorer, open the failed trace, select `payment.process`, and click **Logs from
payment-service in this trace**. In the Log Explorer (`http://localhost:3400/logs/`), filter
**Severity: ERROR** and click any trace id to open its trace.

Grafana does the same: in Explore with Tempo, a span's **Logs for this span** button runs a Loki
query; in Explore with Loki, each line's `trace_id` field has an **Open trace** link. Both are
configured in `infra/grafana/provisioning/datasources/datasources.yaml`.

## Code

The stdout formatter adds the ids from the current span (`services/common/logs.py`):

```python
span_context = trace.get_current_span().get_span_context()
if span_context.is_valid:
    entry["trace_id"] = format(span_context.trace_id, "032x")
    entry["span_id"] = format(span_context.span_id, "016x")
```

The OTLP copy needs no extra code: the `LoggingHandler` from `opentelemetry-instrumentation-logging`
attaches the active span context to every record it converts. Context is passed with `extra`:

```python
log.info("order created", extra={"app.order.id": order_id, "app.order.total_cents": total})
```

> [!NOTE]
> The Python **logs** SDK is still marked experimental (`opentelemetry.sdk._logs`). Traces and
> metrics are stable. The API may change between releases; pin your versions.

## Verification

- `docker compose logs order-service` shows JSON lines with `trace_id`
- The LogQL query by trace id returns only that request's lines
- From an ERROR log line you opened the matching trace, and from a span you opened its logs

## Why it matters

**Logs tell you what happened. Traces tell you where it happened in the request.** A log line
without a trace id is a needle in a haystack; with one, it is a pointer to the exact request,
service and step.

## Common mistakes

- **Logging secrets or personal data.** No passwords, tokens, API keys, card details or emails.
  This lab never logs request bodies.
- **Interpolating values into the message.** `f"order {id} created"` makes every message unique.
  Keep the message constant and put values in `extra`, so you can search and group.
- **Using high-cardinality values as Loki labels.** Ids belong in structured metadata, not in the
  stream selector.
- **Logging an error at every layer as if it were new.** Each service here adds its own context
  ("order-service returned 502: ..."), which is useful; repeating the full stack trace three times
  is not.

## Challenge

Find every log line for one order id, across all services, using only Loki. Hint: start from
`{service_namespace="otel-lab"}` and filter on `app_order_id`. Which services log the order id,
and which only log the trace id? What does that tell you about where to put identifiers?

Next: [06 · Meet the Collector](06-collector.md)
