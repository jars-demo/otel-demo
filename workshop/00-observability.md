# 00 · What is Observability?

> ⏱ 15 minutes · No commands yet: the ideas the rest of the workshop builds on.

## Goal

Understand what problem observability solves, what the three OpenTelemetry signals are, and the
question this whole lab keeps coming back to: *something is broken, how do you know why?*

## What you'll learn

- The difference between monitoring ("is it broken?") and observability ("why?")
- What traces, metrics and logs are, and which question each one answers
- What OpenTelemetry is, and what it is not
- How the lab is organised: a small shop, a telemetry pipeline, and incidents to solve

## Architecture

```text
 Browser ─► api-gateway ─► order-service ─┬─► inventory-service ─► Redis
                                          ├─► payment-service ───► PostgreSQL
                                          └──────────────────────► PostgreSQL

 every service ── traces, metrics, logs (OTLP) ──► OpenTelemetry Collector
                                                     ├─► Tempo       traces
                                                     ├─► Prometheus  metrics
                                                     └─► Loki        logs   ──► Grafana and this site
```

## Prerequisites

None for this chapter. For the next one: Git and Docker with Compose v2, and about 3 GB of memory
available to Docker.

## A checkout that takes 4.8 seconds

A customer clicks **Place order**. The request travels through four services and two data stores
and comes back after 4.8 seconds. A dashboard tells you that: `checkout p95 = 4.8 s`. It does not
tell you **why**.

Without observability you start guessing. Is the payment provider slow? Did someone deploy? Is
the database overloaded? Each guess costs time, and every team tends to believe it is somebody
else's service.

With a **trace** of one slow checkout, the guessing stops:

```text
POST /api/checkout                    4.82 s
├── order.validate                    0.02 s
├── order.reserve_inventory           4.61 s   <- the time is here
│   └── inventory.reserve             4.60 s
│       └── EVALSHA (redis)           4.58 s   <- and specifically here
└── order.charge_payment              0.19 s
```

Then you ask the next question: why is Redis slow? Logs and metrics from the right component
answer that. This is the pattern you will practise again and again:

```text
symptom ─► metrics: what changed, since when ─► traces: where in the request
        ─► logs: what the component reported ─► root cause ─► fix ─► verify recovery
```

## Monitoring vs observability

**Monitoring** watches for failures you predicted: CPU above 90%, error rate above 1%, disk full.
It is necessary and it answers *is something wrong?*

**Observability** is the ability to ask *new* questions of a running system from the data it
already emits, including questions nobody predicted when the code was written. Distributed
systems fail in new ways all the time; observability is how you debug those.

## The three signals

| Signal | Answers | Example from this lab |
|---|---|---|
| **Trace** | What happened to *this* request? | The span tree above |
| **Metric** | How is the system behaving *over time*? | `api-gateway p95 = 240 ms`, 3 requests per second, 0% errors |
| **Log** | What did *this component* report? | `payment provider timeout after 800 ms` |

They are three views of the same system, and they are connected: every log line written during a
request carries that request's `trace_id`. Correlation between them is a major part of this lab.

## What OpenTelemetry is

[OpenTelemetry](https://opentelemetry.io/docs/what-is-opentelemetry/) (OTel) is an open standard
and a set of tools for producing and moving telemetry:

- **APIs and SDKs** in many languages, to create spans, metrics and logs in your code
- **Instrumentation libraries** that do it automatically for common frameworks (FastAPI, HTTP
  clients, Redis, PostgreSQL drivers)
- **OTLP**, one protocol for sending all three signals
- the **Collector**, a service that receives, processes and exports telemetry
- **semantic conventions**: standard names, so `http.request.method` means the same everywhere

OpenTelemetry is **not** a backend. It does not store or display anything. That is the job of
Tempo, Prometheus, Loki and Grafana in this lab, or of any other compatible tool.

## Why it matters

Modern systems are networks of services. The question during an incident is rarely *is it
broken?* (users will tell you), but *where* and *why*, quickly, with confidence, without
guessing. Observability turns "it is probably the database" into evidence.

## Common mistakes

- Treating dashboards as observability. A dashboard answers the questions you thought of in
  advance; incidents ask new ones.
- Collecting everything "just in case". Telemetry costs money and can leak data. Chapter 12 and
  the Security page cover this.
- Thinking OpenTelemetry stores data. It produces and moves it; a backend stores it.

## Challenge

Think of the last production problem you worked on. Write down which of the three signals would
have answered *where* it happened, and which would have answered *why*. Keep the note: you will
compare it with what you can do at the end of the workshop.

Next: [01 · Build the Distributed System](01-distributed-system.md)
