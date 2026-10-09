# 01 · Build the Distributed System

> ⏱ 20 minutes · Start the shop and the observability stack, place an order, and see its trace.

## Goal

Run the whole lab on your machine, check that every part is healthy, and send one real checkout
through four services.

## What you'll learn

- What each of the 14 containers does
- How Docker Compose starts them in the right order with health checks
- How to call the shop's API and get a trace id back

## Architecture

```text
web :3400 ── /api ──► api-gateway :8400 ──► order-service ──► inventory-service ──► redis
                                                    └────────► payment-service ────► postgres
lab-console :8410 (faults, incidents, queries)      otel-collector :4318 ──► tempo · prometheus · loki
grafana :3401
```

The full table of containers is on the [Architecture](https://otel.jishanahmed.in/architecture/)
page.

## Prerequisites

- [Git](https://git-scm.com/downloads)
- [Docker](https://docs.docker.com/get-docker/) with Compose v2 (`docker compose version`)
- About 3 GB of memory for Docker (Docker Desktop: Settings, Resources)
- Free local ports: 3100, 3200, 3400, 3401, 4317, 4318, 8400, 8410, 9090

> [!NOTE]
> Commands are written for a POSIX shell: macOS, Linux, WSL, or Git Bash on Windows. In Windows
> PowerShell, type `curl.exe` instead of `curl`.

## Steps

### 1. Get the code

```bash
git clone https://github.com/jars-demo/otel-demo.git
cd otel-demo
```

> **What it does:** Downloads the repository and enters it.
> **Why:** Everything, from the services to the Collector configuration, lives in this repository.
> **Expected:** A folder with `services/`, `infra/`, `incidents/`, `workshop/` and `docker-compose.yml`.

### 2. Start everything

```bash
docker compose up -d --build --wait
```

> **What it does:** Builds the service image and the website image, then starts all containers in
> the background and waits until every container with a health check reports healthy.
> **Why:** One command brings up the application, the telemetry pipeline and the backends.
> `--wait` saves you from guessing when it is ready.
> **Expected:** The first run takes a few minutes (image downloads and builds). It ends with every
> container `Healthy` or `Started`, and your prompt returns.

### 3. Check the containers

```bash
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
```

> **What it does:** Lists the lab's containers and their state.
> **Why:** Confirms nothing exited or is restarting.
> **Expected:** Every service `Up`. The application services, databases, Prometheus and Grafana
> also show `(healthy)`.

```text
SERVICE             STATUS
api-gateway         Up 2 minutes (healthy)
grafana             Up 2 minutes (healthy)
inventory-service   Up 2 minutes (healthy)
lab-console         Up 2 minutes (healthy)
loki                Up 2 minutes
order-service       Up 2 minutes (healthy)
otel-collector      Up 2 minutes
payment-service     Up 2 minutes (healthy)
postgres-db         Up 2 minutes (healthy)
prometheus          Up 2 minutes (healthy)
redis-db            Up 2 minutes (healthy)
tempo               Up 2 minutes
toxiproxy           Up 2 minutes
web                 Up 2 minutes
```

Tempo, Loki, the Collector and Toxiproxy ship as minimal images without a shell, so Docker cannot
run a health check inside them. The lab-console checks them over HTTP instead (step 4).

### 4. Ask the lab whether it is ready

```bash
curl -s localhost:8410/lab/status
```

> **What it does:** Asks the lab-console to probe every component: each service's `/ready`, the
> Collector's health endpoint, and the backends' readiness endpoints.
> **Why:** "The container is running" is not the same as "it can do its job".
> **Expected:** Every component `"up"`. Loki can say `"not_ready"` for its first 15 seconds.

```json
{"components":{"api-gateway":"up","order-service":"up","inventory-service":"up","payment-service":"up","otel-collector":"up","tempo":"up","prometheus":"up","loki":"up","toxiproxy":"up"},"incident":null,"load":{...}}
```

### 5. Browse the catalog

```bash
curl -s localhost:8400/api/products/prod-001
```

> **What it does:** Asks the gateway for one product. The gateway calls inventory-service, which
> reads Redis.
> **Why:** The smallest request that crosses a service boundary and touches a data store.
> **Expected:** One product as JSON.

```json
{"id":"prod-001","name":"Mechanical Keyboard","description":"Tenkeyless, hot-swappable switches.","category":"input","price_cents":8900,"stock":50000}
```

### 6. Place an order

```bash
curl -s -i -X POST localhost:8400/api/checkout \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"user-123","items":[{"product_id":"prod-001","quantity":2}]}'
```

> **What it does:** Runs a full checkout: validate, create the order, reserve stock, take payment,
> complete. `-i` prints the response headers.
> **Why:** This is the request every incident in the lab is about.
> **Expected:** `HTTP/1.1 201 Created`, an `x-trace-id` header and a completed order.

```text
HTTP/1.1 201 Created
content-type: application/json
x-trace-id: 980ab2872ab44c05c8aa2b45f7ff8f81

{"order_id":"ord_47cad5296e544244","status":"completed","total_cents":17800,"payment_id":"pay_004bdf1ef5ed4838"}
```

Your ids will differ. Copy your `x-trace-id`.

### 7. Open the trace

Open `http://localhost:3400/traces/?id=<your trace id>` in a browser.

> **What it does:** The Trace Explorer asks Tempo (through the lab-console) for that trace.
> **Why:** This is the first time you see one request across every service.
> **Expected:** About 25 spans from four services: the gateway's `POST /api/checkout` at the top,
> the `checkout` workflow in order-service, Redis commands under inventory-service, SQL statements
> under order-service and payment-service.

If it says spans are still arriving, wait five seconds and refresh: services export in batches.

## Code

The gateway puts the trace id in the response so a client can find its own trace. The header is
set by a middleware that runs inside the request's server span
(`services/gateway/main.py`):

```python
span_context = trace.get_current_span().get_span_context()
if span_context.is_valid:
    response.headers["X-Trace-Id"] = format(span_context.trace_id, "032x")
```

## Verification

- `docker compose ps` shows every container up
- `curl -s localhost:8410/lab/status` reports every component `"up"`
- The checkout returned 201 and its trace opens in the Trace Explorer with four services

## Why it matters

You now have a realistic, if small, distributed system: requests cross process boundaries, a
cache and a database, and every hop is instrumented. Everything later in the workshop is about
reading what it reports.

## Common mistakes

- **A port is already in use.** Find what uses it, or change the left-hand side of that port in
  `docker-compose.yml` (for example `127.0.0.1:3402:3000` for Grafana).
- **Docker has too little memory.** Containers get killed and restart. Give Docker at least 3 GB.
- **Opening the trace too quickly.** Spans arrive within about five seconds.
- **Using `localhost:3000` for Grafana.** This lab uses port 3401.

## Challenge

Place an order for a product that does not exist (`prod-999`). What status code do you get, and
does a trace exist for it? Which services does that trace include, and why fewer than before?

Next: [02 · Instrument Your Application](02-instrumentation.md)
