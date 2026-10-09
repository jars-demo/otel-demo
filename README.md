<h1 align="center">OpenTelemetry Incident Lab</h1>

<p align="center"><b>Break it. Trace it. Find it. Fix it.</b></p>

<p align="center">
  A hands-on OpenTelemetry workshop where you operate a small distributed application,<br>
  intentionally introduce failures, and use traces, metrics, and logs to diagnose real<br>
  distributed-system problems.
</p>

<p align="center">
  <a href="https://github.com/jars-demo/otel-demo/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/jars-demo/otel-demo/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="OpenTelemetry Python 1.45" src="https://img.shields.io/badge/OpenTelemetry%20Python-1.45-425cc7">
  <img alt="Collector 0.162" src="https://img.shields.io/badge/Collector-0.162-425cc7">
  <img alt="Python 3.13" src="https://img.shields.io/badge/Python-3.13-3776ab">
  <img alt="Docker Compose" src="https://img.shields.io/badge/Docker-Compose-2496ed">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-lightgrey"></a>
</p>

<p align="center">
  <b>Live site:</b> <a href="https://otel.jishanahmed.in">otel.jishanahmed.in</a> ·
  <b>Repository:</b> <a href="https://github.com/jars-demo/otel-demo">github.com/jars-demo/otel-demo</a>
</p>

> [!IMPORTANT]
> This is an educational project inspired by real observability architectures. It is **not** a
> production observability platform, and it is **not** the official
> [OpenTelemetry Demo](https://opentelemetry.io/docs/demo/). It is not affiliated with the
> OpenTelemetry project or the CNCF.

A checkout is slow. A dashboard says `p95 = 3.4 s`. It does not say **why**. In this lab you follow
the trace down to the Redis call that holds the time, read the logs that share its trace id, find
the root cause, fix it, and prove recovery against a baseline you measured before anything broke.

- **A system small enough to understand completely**: four FastAPI services, PostgreSQL, Redis
- **A real telemetry pipeline**: OpenTelemetry SDK → Collector → Tempo, Prometheus, Loki → Grafana
- **Real faults**: latency added on the network path by Toxiproxy, errors raised in code
- **Six incidents** with a baseline, inject, investigate, fix, verify cycle, and a final challenge
- **16 chapters**, about 5 hours; every command says what it does, why, and what you should see
- **Nothing faked**: every number labelled live comes from the backends

## Contents

- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Telemetry architecture](#telemetry-architecture)
- [The workshop](#the-workshop)
- [Incident Lab](#incident-lab)
- [Fault injection](#fault-injection)
- [Docker](#docker)
- [Security](#security)
- [Production considerations](#production-considerations)
- [Testing](#testing)
- [CI/CD](#cicd)
- [Repository layout](#repository-layout)
- [Versions](#versions)
- [Contributing](#contributing)
- [License](#license)

## Quick start

You need [Git](https://git-scm.com/downloads) and [Docker](https://docs.docker.com/get-docker/)
with Compose v2, and about 3 GB of memory available to Docker.

```bash
git clone https://github.com/jars-demo/otel-demo.git
cd otel-demo
docker compose up -d --build --wait
```

**What it does:** builds the images and starts the 14 containers, waiting until every health check
passes. **Expected:** the first run takes a few minutes; then every container is up.

| URL | What |
|---|---|
| <http://localhost:3400> | The workshop site with live views: Incident Lab, Trace Explorer, Metrics, Logs |
| <http://localhost:3401> | Grafana, with Tempo, Prometheus and Loki linked together |
| <http://localhost:8400/docs> | The shop API (Swagger UI) |
| <http://localhost:8410/docs> | The lab-console API (faults, incidents, load, telemetry queries) |

Check everything end to end:

```bash
./scripts/verify.sh
```

**What it does:** probes every component, places a real checkout, and waits for its trace in Tempo,
its logs in Loki and its metrics in Prometheus. **Expected:** `All checks passed.`

Then open <http://localhost:3400/workshop/> and start with chapter 00. A port is taken? Copy
`.env.example` to `.env` and change it.

## Architecture

```text
                     Browser
                        │
             web (nginx, static site) ── /lab ──► lab-console  (faults, incidents, load, queries)
                        │ /api
                        ▼
                   api-gateway
                   │         │
                   ▼         ▼
            order-service ──► inventory-service ──► redis    ─► redis-db
                   │    └───► payment-service ────► postgres ─► postgres-db
                   └────────────────────────────────► postgres ─► postgres-db
                                                   (Toxiproxy answers as redis and postgres)
```

A checkout validates the cart (prices from inventory-service), creates the order in PostgreSQL,
reserves stock in Redis with one atomic Lua script, authorises the payment, and completes the order.
On failure it releases the stock and marks the order failed.

| Container | Role | Host port |
|---|---|---|
| `web` | The site; proxies `/api` and `/lab` on the same origin | 3400 |
| `api-gateway` | Public API, input validation, `X-Trace-Id` on every response | 8400 |
| `order-service` | Orders and the checkout workflow | internal |
| `inventory-service` | Catalog, stock and reservations (Redis) | internal |
| `payment-service` | Payment authorisation (PostgreSQL) | internal |
| `postgres-db`, `redis-db` | Data stores | internal |
| `toxiproxy` | TCP proxy in front of both stores; adds latency on demand | internal |
| `otel-collector` | Receives OTLP; one pipeline per signal | 4317, 4318 |
| `tempo`, `prometheus`, `loki` | Trace, metric and log storage | 3200, 9090, 3100 |
| `grafana` | Dashboards and Explore | 3401 |
| `lab-console` | Lab tooling, deliberately not instrumented | 8410 |

## Telemetry architecture

```text
service ── OpenTelemetry SDK ── OTLP/HTTP ──► otel-collector
   traces:  otlp ─► memory_limiter ─► attributes/scrub ─► batch ─► Tempo (OTLP/gRPC)
   metrics: otlp ─► memory_limiter ───────────────────► batch ─► Prometheus (native OTLP)
   logs:    otlp ─► memory_limiter ─► attributes/scrub ─► batch ─► Loki (native OTLP)
Tempo metrics-generator ─► service-graph and span metrics ─► Prometheus
Grafana ◄── all three, with trace-to-logs, logs-to-trace and metrics-to-trace links
```

- **Traces**: FastAPI, httpx, Redis and psycopg instrumentation libraries, plus manual spans for
  business steps (`checkout`, `order.validate`, `inventory.reserve`, `payment.process`, ...).
  Stable HTTP and database semantic conventions (`OTEL_SEMCONV_STABILITY_OPT_IN=http,database`).
- **Metrics**: `http.server.request.duration` (RED), business counters (`orders.checkouts`,
  `payments.processed`, `inventory.reservations`) and the `db.client.connection.*` pool metrics.
- **Logs**: one `logging` call produces a JSON line on stdout and an OTLP record in Loki, both with
  `trace_id` and `span_id`. The Python logs SDK is still marked experimental.
- **Resources**: `service.name`, `service.version`, `service.namespace`, `service.instance.id`,
  `deployment.environment.name` on everything.

The Collector configuration is [`infra/otel/collector.yaml`](infra/otel/collector.yaml); a tail
sampling variant is [`infra/otel/collector-sampling.yaml`](infra/otel/collector-sampling.yaml).

## The workshop

| Chapter | You will | Time |
|---|---|---|
| [00 · What is Observability?](workshop/00-observability.md) | Signals, telemetry, and "why is it broken?" | 15 min |
| [01 · Build the Distributed System](workshop/01-distributed-system.md) | Start the lab, place an order, open its trace | 20 min |
| [02 · Instrument Your Application](workshop/02-instrumentation.md) | Send your own trace; SDK, library and manual instrumentation | 20 min |
| [03 · Understand Traces](workshop/03-traces.md) | Kinds, status, exceptions, context propagation | 20 min |
| [04 · Add Metrics](workshop/04-metrics.md) | Instruments, RED, histograms, PromQL | 20 min |
| [05 · Correlate Logs](workshop/05-logs.md) | Structured logs, LogQL, trace to logs and back | 15 min |
| [06 · Meet the Collector](workshop/06-collector.md) | Receivers, processors, exporters, validate, self-metrics | 15 min |
| [07 · Build Telemetry Pipelines](workshop/07-pipelines.md) | Enrich and filter in the Collector, verify, roll back | 20 min |
| [08 · Break the System](workshop/08-fault-injection.md) | Baselines, the fault catalog, Toxiproxy | 15 min |
| [09 · Investigate an Incident](workshop/09-incident-response.md) | INC-001 and INC-002 with a repeatable method | 25 min |
| [10 · Trace a Database Problem](workshop/10-database-debugging.md) | INC-003: SQL spans, DB metrics, hidden round trips | 20 min |
| [11 · Diagnose Cascading Latency](workshop/11-cascading-failures.md) | INC-004 and INC-005: self time and the critical path | 20 min |
| [12 · Sampling and Cost](workshop/12-sampling.md) | Tail sampling on live traffic, cardinality, cost | 20 min |
| [13 · Docker Deployment](workshop/13-docker.md) | Images, health checks, hardening, start, stop, reset | 15 min |
| [14 · Production Architecture](workshop/14-production.md) | Agents and gateways, SLOs, security, cost | 20 min |
| [15 · Final Incident Challenge](workshop/15-final-challenge.md) | INC-999: everything looks healthy | 30 min |

## Incident Lab

Each incident lives in [`incidents/`](incidents) as one YAML file (symptom, trigger, investigation
steps, root cause question, evidence, remediation, verification) that drives both the lab-console
and the website.

| ID | Incident | Symptom | Learn to use |
|---|---|---|---|
| INC-001 | Slow Checkout | Checkout takes about 3.4 s | Critical path, Redis client spans |
| INC-002 | Payment Failure | Every checkout returns 502 | Error status, exception events, correlated logs |
| INC-003 | Database Slowdown | Order creation is slow, browsing is fast | SQL spans, `db.client.operation.duration`, self time |
| INC-004 | Inventory Service Failure | One checkout in three fails | Comparing a failed and a good trace |
| INC-005 | Cascading Latency | Three services alert at once | Self time vs duration, the bottleneck span |
| INC-999 | Final Incident Challenge | Slow and failing, every dependency healthy | Trace gaps, connection pool saturation |

A run measures a **baseline** for 45 seconds under traffic, injects the fault without saying which,
lets you investigate, applies the fix when you ask, and **verifies recovery** from Prometheus: p95
within 1.5 times the baseline and errors under 2%.

## Fault injection

| Fault | How | Bound |
|---|---|---|
| API latency, API error rate | Switch in api-gateway | 5 s, 50% |
| Redis latency, database latency | Toxiproxy latency toxic on the network path | 5 s, 3 s |
| Payment provider timeout | Switch in payment-service | on/off |
| Inventory errors, slow inventory code | Switches in inventory-service | every n-th (n ≤ 10), 5 s |
| Connection held across network calls | Switch in order-service (pool of 2) | on/off |

Faults are local to the Docker network, deterministic, bounded and reversible:
`curl -X POST localhost:8410/lab/faults/reset` clears all of them. The load generator only calls
this lab's gateway, at most 20 requests per second for 15 minutes. Nothing executes commands, touches
the host or sends traffic outside the lab.

## Docker

| Command | What it does |
|---|---|
| `./scripts/start.sh` | Build if needed, start, wait for health checks |
| `./scripts/stop.sh` | Stop and remove containers; data is kept |
| `./scripts/reset.sh` | Remove containers **and volumes** (asks first) |
| `./scripts/load-test.sh mixed 5 60` | Send capped traffic |
| `./scripts/verify.sh` | End-to-end check of a running lab |

Images are multi-stage (no build tools at runtime) and run as non-root. Application containers run
with a read-only root filesystem, no Linux capabilities, `no-new-privileges` and an init process.
Every container has a memory limit; the lab uses about 2 to 2.5 GB under load. Host ports bind to
`127.0.0.1` only.

## Security

Telemetry is a copy of what your system does. The services never record passwords, tokens, keys,
card data or request bodies; SQL is recorded with placeholders, not values; user ids are
pseudonymous. The Collector deletes sensitive attributes as a safety net (`attributes/scrub`).

The lab's settings are for a laptop: anonymous Grafana admin, plain-text OTLP and the demo database
credential `shop`/`shop` must never be reused anywhere shared. See the Security chapter of the site
and [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) for reporting issues.

## Production considerations

| Workshop | Production |
|---|---|
| One Collector | Agents per node plus a highly available gateway pool |
| Plain OTLP, anonymous access | TLS, mTLS, authenticated receivers, SSO |
| Keep every trace | Head sampling in SDKs, tail sampling at gateways |
| Local single binaries, 72 h retention | Distributed backends on object storage, deliberate retention |
| No alerting | SLO burn-rate alerts on RED and saturation |

Chapter 14 and the Production page cover queues, retries, network boundaries, cardinality and cost.

## Testing

```bash
uv sync                                 # Python 3.13 and dependencies
uv run pytest                           # unit tests, in-memory telemetry exporters
uv run pytest -m integration            # end-to-end, against a running lab
uv run ruff check . && uv run ruff format --check .
cd frontend && npm ci && npm run lint && npm run typecheck && npm run build
```

Unit tests run the real instrumentation against in-memory exporters and assert on actual spans,
metrics and log records: span names and parentage, semantic-convention attributes, `traceparent` on
every outgoing call, exception events and status on failures, OK status on business outcomes, trace
context on log records, fault bounds, the trace-tree math and the incident definitions.

## CI/CD

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request: Ruff and
the unit tests, the frontend lint, typecheck and build, Collector and Compose configuration
validation, the Docker image builds, the full stack with the integration tests and `verify.sh`, and
a Trivy scan for vulnerable dependencies, secrets and misconfigurations. Actions are pinned to commit
SHAs.

## Repository layout

```text
services/        Python services: common/ (telemetry, logs, faults, db), gateway/, orders/,
                 inventory/, payment/, lab/ (lab-console); one Dockerfile for all
frontend/        Next.js site: live views, Incident Lab, workshop renderer; nginx in Docker
infra/           otel/ (Collector), tempo/, prometheus/, loki/, grafana/, postgres/, toxiproxy/
incidents/       one folder per incident, incident.yaml
workshop/        chapters 00 to 15 (also rendered by the site)
examples/        first_span.py (chapter 02)
scripts/         setup, start, stop, reset, load-test, verify
tests/           unit tests; tests/integration/ against the running lab
docs/            CONTRIBUTING.md, CHANGELOG.md
```

## Versions

| Component | Version |
|---|---|
| Python | 3.13 |
| OpenTelemetry Python API and SDK | 1.45.1 |
| OpenTelemetry instrumentation libraries | 0.66b1 (beta) |
| OpenTelemetry Collector (contrib) | 0.162.0 |
| Grafana Tempo | 3.1.0 |
| Prometheus | 3.15.0 |
| Grafana Loki | 3.7.8 |
| Grafana | 13.2.3 |
| PostgreSQL | 18.6 |
| Redis | 8.8.3 |
| Toxiproxy | 2.12.0 |
| FastAPI | 0.143.0 |
| Next.js | 16.4.0 |
| Node.js (build) | 22 |

## Contributing

Contributions are welcome. Read [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) and
[`AGENTS.md`](AGENTS.md): every command in the docs must be run and its real output pasted, and
behaviour changes need matching tests and chapter updates. Changes are recorded in
[`docs/CHANGELOG.md`](docs/CHANGELOG.md).

This repository follows the [JARS Skills](https://github.com/jars-demo/jars-skills) playbooks
([skills.jishanahmed.in](https://skills.jishanahmed.in)).

## License

[MIT](LICENSE). Built by [JARS](https://jishanahmed.in).
