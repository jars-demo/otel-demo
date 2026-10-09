# 14 · Production Architecture

> ⏱ 20 minutes · What changes between this lab and a production observability platform.

## Goal

Map every part of the lab to its production counterpart, and know what you would add before
running any of it for real.

## What you'll learn

- Collector agents and gateways, and why there are two tiers
- Queues, retries, TLS, authentication and network boundaries
- Retention, sampling, cardinality and cost as design decisions
- SLIs, SLOs and error budgets, and alerting on symptoms
- The four golden signals

## Architecture

```text
 app + SDK ──► Collector AGENT (per node) ──TLS──► Collector GATEWAY pool ──► backends
               enrich, batch, hand off fast        policy, tail sampling, auth, routing
```

## Prerequisites

Chapters 06, 07 and 12. The [Production](https://otel.jishanahmed.in/production/) and
[Security](https://otel.jishanahmed.in/security/) pages go deeper.

## Workshop vs production

| | Workshop | Production |
|---|---|---|
| Collectors | One container | Agents per node plus a highly available gateway pool |
| Delivery | In-memory queues, default retries | Persistent sending queues, bounded retries, backpressure alerts |
| Transport | Plain OTLP on a private Docker network | TLS everywhere, mTLS between Collector tiers |
| Authentication | None, anonymous Grafana admin | Authenticated receivers, SSO, per-team access |
| Backends | Single binaries on local disk | Distributed, on object storage, replicated |
| Retention | 72 hours | Per signal and tenant, set by cost and compliance |
| Sampling | Keep everything | Head sampling in SDKs, tail sampling at gateways |
| Cardinality | Small, controlled | Enforced limits, label allow-lists |
| Alerting | None | SLO burn-rate alerts |
| The pipeline itself | Not monitored | Monitored like any production service |

## Steps

### 1. Agent vs gateway

An **agent** runs next to the workload. It adds host and Kubernetes metadata, batches, and takes
data off the application quickly so the app never blocks on a slow network. A **gateway** is a
shared, scaled service where central policy lives: tail sampling, redaction, routing to several
backends, rate limits, and the credentials for the backends. Tail sampling only works at the
gateway, and only if every span of a trace reaches the same instance, which a `loadbalancing`
exporter on the agents arranges by trace id.

### 2. Reliable delivery

Exporters have a sending queue and retries. In production, back the queue with storage so a
restart does not lose buffered data, size it from measured throughput, and alert on
`otelcol_exporter_queue_size` and on refused or failed items (chapter 06 showed these metrics).

### 3. Golden signals and SLOs

The four golden signals, from Google's SRE book (not an OpenTelemetry concept), and where they are
in this lab:

| Signal | Here |
|---|---|
| Latency | `http.server.request.duration` percentiles |
| Traffic | request rate from the same histogram |
| Errors | 5xx share; exceptions on spans |
| Saturation | `db.client.connection.*`: pool usage, pending requests, wait time |

An **SLO** for checkout could be *99% of checkouts succeed in under 500 ms over 28 days*. The
**error budget** is the 1% that may fail. During INC-001 every checkout took about 3.4 s: the budget
for a month burns in minutes, and a **burn-rate alert** pages someone. Alert on that symptom; use
traces and logs, as in chapters 09 to 11, to find the cause.

### 4. Security

Telemetry leaks whatever you put in it. Never record passwords, tokens, API keys, card data or
unnecessary personal data. Scrub in the Collector as a safety net (`attributes/scrub` in this lab),
encrypt in transit, authenticate receivers, restrict who can query, and delete data you no longer
need.

### 5. Cost

Volume (spans per request times traffic), retention, cardinality and log verbosity drive the bill.
The observability system needs a budget, capacity planning and an owner, like any other system.

## Code

What a gateway's traces pipeline often looks like (an illustration of the shape, not a drop-in
configuration):

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]            # with TLS and an authenticator extension
      processors: [memory_limiter, redaction, tail_sampling, batch]
      exporters: [otlp_grpc/backend]   # with a persistent sending_queue
```

## Verification

- You can explain where tail sampling must run, and why
- You can name the saturation signal in this lab
- You can list five things to add before running this stack anywhere shared

## Why it matters

The concepts you practised (signals, propagation, pipelines, sampling, correlation) are exactly the
production ones. What production adds is scale, reliability, security and cost control around them.

## Common mistakes

- **Copying the lab's settings to a shared environment.** Anonymous admin and plain-text OTLP are
  for a laptop.
- **One Collector for everything.** It becomes a single point of failure.
- **Alerting on causes (CPU, every ERROR line) instead of symptoms.** Pages lose their meaning.
- **No owner for the observability platform.** It decays like any unowned system.

## Challenge

Draw your own production layout for this shop on Kubernetes: where the agents run, how many gateway
replicas, which processors run where, which backends, and which three alerts you would create first.
Compare it with the table above.

Next: [15 · Final Incident Challenge](15-final-challenge.md)
