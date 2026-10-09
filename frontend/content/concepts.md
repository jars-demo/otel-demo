## Three signals, one system

Observability is being able to answer new questions about a running system from the data it
emits, without shipping new code to answer them. OpenTelemetry standardises three kinds of data,
called **signals**. They are different views of the same requests:

| Signal     | The question it answers                        | In this lab                                                                       |
| ---------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| **Trace**  | What happened to _this_ request, step by step? | A checkout touches four services, Redis and PostgreSQL: one trace, about 25 spans |
| **Metric** | How is the system behaving _over time_?        | Requests per second, error rate, p95 latency per service                          |
| **Log**    | What did _this component_ report?              | `payment provider timeout after 800 ms`, with a `trace_id`                        |

They are connected by identifiers. A log line carries the `trace_id` and `span_id` of the span
that was active when it was written. A trace carries the `service.name` its metrics are labelled
with. Correlation means you can jump from any one to the others:

```text
metric: checkout p95 jumped        ->  which requests were slow?
trace:  inventory.reserve 1.5 s     ->  what did inventory-service say at the time?
log:    trace_id=4bf9...            ->  open the trace this line belongs to
```

> [!TIP]
> Logs tell you what happened. Traces tell you where it happened in the request. Metrics tell
> you how often, and since when.

## Anatomy of a trace

A **trace** is the record of one request as it moves through the system. It is a tree of
**spans**. Each span is one operation: an HTTP request handled, a call made, a SQL statement, a
business step. A span has:

- a **name** (`POST /api/checkout`, `inventory.reserve`, `INSERT`)
- a **trace id** shared by every span in the trace, and its own **span id**
- a **parent span id** (absent on the root): that is what makes the tree
- a **start time** and **duration**
- a **kind**: `SERVER` (handling an incoming request), `CLIENT` (making an outgoing call),
  `INTERNAL` (work inside the process), plus `PRODUCER` and `CONSUMER` for messaging
- **attributes**: key/value facts, like `http.request.method = POST` or `db.system.name = redis`
- **events**: timestamped things that happened during the span, most often an `exception`
- a **status**: `UNSET`, `OK` or `ERROR`

### Context propagation

How does inventory-service know its span belongs to the gateway's trace? The caller sends a
`traceparent` header (the [W3C Trace Context](https://www.w3.org/TR/trace-context/) standard)
with every request:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             |  |                                |                |
             |  trace id (16 bytes)              parent span id   flags (sampled)
             version
```

The HTTP client instrumentation injects it, the server instrumentation extracts it, and the new
span joins the trace. No service passes trace ids around by hand.

### Self time and the critical path

A span's **duration** includes everything it waited for. Its **self time** is the part not
covered by any child span: the time the operation spent on its own. The **critical path** is the
chain of spans that decided when the request finished. During an incident, the span on the
critical path with the most self time is the first place to look. The Trace Explorer marks it.

## Telemetry naming that scales

Names are an interface. If every team called the HTTP method something different
(`request_method`, `httpMethod`, `verb`), no dashboard, alert or tool could work across services.
OpenTelemetry's **semantic conventions** define standard names so that telemetry from any
language and any library means the same thing:

| Area                        | Standard attributes used in this lab                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Service identity (resource) | `service.name`, `service.version`, `service.namespace`, `service.instance.id`, `deployment.environment.name` |
| HTTP                        | `http.request.method`, `http.response.status_code`, `url.path`, `url.scheme`, `server.address`               |
| Database                    | `db.system.name`, `db.namespace`, `db.query.text`, `db.operation.name`                                       |
| Errors                      | `error.type`, and on exception events `exception.type`, `exception.message`, `exception.stacktrace`          |
| Users                       | `user.id` (a pseudonymous id, never an email)                                                                |

> [!IMPORTANT]
> The instrumentation libraries still emit the old, pre-1.0 names (`http.method`, `db.system`,
> `db.statement`) by default for compatibility. This lab opts into the stable names with
> `OTEL_SEMCONV_STABILITY_OPT_IN=http,database`. Check which set your backend dashboards expect.

When no convention exists, namespace your own attributes so they cannot collide with a future
standard one: this lab uses `app.order.id`, `app.payment.outcome` and so on. Do not invent a
custom name when a standard one already exists.

### Resources

A **resource** describes the entity producing telemetry. It is attached once to everything a
process emits, rather than repeated on every span. Every service here sets `service.name`,
`service.version`, `service.namespace = otel-lab`, `service.instance.id` (the container id) and
`deployment.environment.name = demo`. In Prometheus these become labels such as
`service_name="order-service"`; in Loki, the `service_name` stream label.

## Metrics, RED and the golden signals

The SDK offers a few **instruments**: a **counter** (only goes up: requests, orders), an
**up-down counter** (connections in use), a **gauge**, and a **histogram** (a distribution: request
durations). Histograms are what percentiles come from.

**RED** is a simple recipe for any request-driven service:

- **Rate**: requests per second
- **Errors**: the share that failed
- **Duration**: how long they took, as percentiles (p50, p95, p99)

The four **golden signals** come from Google's Site Reliability Engineering book, not from
OpenTelemetry: **latency**, **traffic**, **errors** and **saturation**. RED covers the first three.
Saturation is "how full is it": in this lab, the database connection pool metrics
(`db.client.connection.count`, `.pending_requests`, `.wait_time`) are the saturation signal, and
the final challenge depends on them.

> [!NOTE]
> A p95 computed from a histogram is an estimate: Prometheus interpolates inside the bucket the
> 95th percentile falls into. That is why the services configure finer buckets with an SDK
> **View**. Wide buckets would turn 3.4 s into "somewhere between 2.5 and 5 s".

## SLI, SLO and error budget

- **SLI** (service level indicator): a measurement of what users experience. Here: _the share of
  checkout requests that complete successfully in under 500 ms_.
- **SLO** (objective): the target for the SLI over a window. Here: _99% of checkouts under 500 ms_.
- **Error budget**: what the SLO allows to fail. At 99%, 1 checkout in 100 may be slow or fail.

During INC-001 every checkout takes about 3.4 s, so the SLI drops to nearly 0% and the budget for
the whole window burns in minutes. The SLO turns "is this bad?" into a number, and telemetry is
what computes it. This lab teaches the idea; it does not implement an SLO platform.

## Cardinality

**Cardinality** is the number of distinct label combinations a metric has. Every combination is a
separate time series that the metrics backend stores and indexes.

```text
http_server_request_duration_seconds{service_name, http_request_method, http_response_status_code, http_route}
  4 services x 3 methods x 6 status codes x 8 routes   = 576 series     fine

... add user_email as a label, with 100,000 users       = 57,600,000 series   not fine
```

Good metric labels have a small, bounded set of values: method, status code, route template,
outcome. Bad ones are unbounded: user ids, emails, order ids, request ids, full URLs with ids in
them, timestamps. Put those on **spans** and **logs**, where each event is stored once, never on
metrics. In this lab `app.order.id` is a span attribute; the `orders.checkouts` counter only has
`app.checkout.outcome` (five possible values).

## Observability is not free

Telemetry is data, and data costs money: to send, to store, to index and to query.

| Driver          | What it means                           | Levers                                             |
| --------------- | --------------------------------------- | -------------------------------------------------- |
| Volume          | Spans per request x requests per second | Sampling; fewer, more meaningful spans             |
| Retention       | How long you keep it                    | Shorter for raw data, longer for aggregates        |
| Cardinality     | Series in the metrics store             | Bounded labels; drop or aggregate in the Collector |
| Log verbosity   | DEBUG in production is expensive        | Levels, sampling of repetitive lines               |
| Payload size    | Huge attributes (stack traces, SQL)     | Truncation limits, attribute filtering             |
| Export overhead | Requests, connections, CPU              | Batching, compression                              |

The observability system is itself a production system. It needs capacity planning, its own
monitoring (the Collector exposes metrics about what it accepted, refused and dropped), and
engineering decisions about what is worth keeping.
