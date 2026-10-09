# 13 · Docker Deployment

> ⏱ 15 minutes · How the lab is built and started: images, health checks, hardening, start, stop, reset.

## Goal

Understand how the 14 containers are built, ordered, health-checked, hardened and limited, and
manage the lab with the scripts.

## What you'll learn

- Multi-stage images that ship no build tools
- Health checks and `depends_on` conditions instead of sleeps
- Container hardening: non-root, read-only, no capabilities
- Memory limits and expected resource usage
- Start, stop and reset, and what each keeps

## Architecture

```text
services/Dockerfile   build (uv, dependencies) ──► runtime (python slim + .venv + source), user 10001
frontend/Dockerfile   deps (npm ci) ──► build (next build) ──► runtime (nginx-unprivileged + static files)
docker-compose.yml    14 services · 5 named volumes · one network · ports on 127.0.0.1 only
```

## Prerequisites

Chapter 01.

## Steps

### 1. Read the service image

`services/Dockerfile` has two stages. The first resolves dependencies with uv; the second copies
only the virtual environment and the source:

```dockerfile
FROM ${PYTHON_IMAGE} AS build
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

FROM ${PYTHON_IMAGE} AS runtime
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app
COPY --from=build /app/.venv /app/.venv
COPY services/ /app/
USER 10001
```

Dependencies are copied before the source, so editing code reuses the dependency layer. The cache
mount keeps downloaded wheels between builds without storing them in the image. One image serves
all five Python services; Compose picks one with `command: ["python", "-m", "orders"]`.

### 2. Startup order without sleeps

```yaml
order-service:
  depends_on:
    postgres-db:       { condition: service_healthy }
    inventory-service: { condition: service_healthy }
    payment-service:   { condition: service_healthy }
```

Compose starts a container only when its dependencies report healthy. Each image defines how:
`pg_isready` for PostgreSQL, `redis-cli ping` for Redis, `/health` for the services. Tempo, Loki, the
Collector and Toxiproxy are minimal images without a shell, so the lab-console checks their HTTP
readiness endpoints instead.

`/health` (liveness) says the process serves HTTP. `/ready` (readiness) also checks dependencies:

```bash
curl -s localhost:8400/ready
docker compose exec order-service python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/ready').read().decode())"
```

> **What it does:** Asks the gateway, then order-service from inside its container, whether they
> are ready.
> **Why:** A service that runs but cannot reach its database should not receive traffic. The
> telemetry backend is deliberately not a readiness dependency: losing observability must not take
> the shop down.
> **Expected:** `{"status":"ready","checks":{}}` for the gateway (no dependencies of its own) and
> `{"status":"ready","checks":{"postgres":"ok"}}` for order-service.

### 3. Hardening

Every Python service gets:

```yaml
init: true                                  # tini as PID 1: signals and zombie processes
read_only: true                             # the root filesystem cannot be written
tmpfs: [/tmp]
cap_drop: [ALL]                             # no Linux capabilities
security_opt: [no-new-privileges:true]      # no privilege escalation
deploy:
  resources:
    limits:
      memory: 192m
```

```bash
docker compose exec order-service sh -c 'id; touch /app/x'
```

> **What it does:** Prints the user and tries to write into the application directory.
> **Why:** Proves the container runs unprivileged on a read-only filesystem.
> **Expected:** `uid=10001(app)` and `touch: cannot touch '/app/x': Read-only file system`.

### 4. Resource usage

```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}'
```

> **What it does:** One snapshot of memory per container.
> **Why:** Know what the lab costs your machine.
> **Expected:** About 2 to 2.5 GB in total under load. The largest are Tempo, Prometheus, Loki and
> Grafana. Every container's limit is set in `docker-compose.yml`; the sum is about 3.3 GB.

### 5. Start, stop, reset

| Script | Does | Keeps your data? |
|---|---|---|
| `./scripts/setup.sh` | Checks Docker and Compose, builds the images | yes |
| `./scripts/start.sh` | Builds if needed, starts everything, waits for health | yes |
| `./scripts/stop.sh` | Stops and removes the containers | yes (volumes kept) |
| `./scripts/reset.sh` | Removes containers **and volumes** | **no**: asks you to type `reset` |
| `./scripts/load-test.sh [scenario] [rps] [s]` | Sends capped traffic | not applicable |
| `./scripts/verify.sh` | Checks health, a checkout, and its trace, logs and metrics | not applicable |

```bash
./scripts/verify.sh
```

> **What it does:** Probes every component, resets faults, places a real checkout, then waits until
> its trace is in Tempo, its logs are in Loki and metrics are in Prometheus.
> **Why:** One command that proves the whole pipeline works end to end.
> **Expected:** A list of `ok` lines ending with `All checks passed.`

> [!WARNING]
> `reset.sh` deletes every order, trace, metric, log and Grafana change stored by the lab. It asks
> before doing it; `-y` skips the question.

## Code

Telemetry and data live in named volumes (`postgres-data`, `tempo-data`, `prometheus-data`,
`loki-data`, `grafana-data`), so a stop or a rebuild keeps them and only `down -v` removes them.
Redis runs without persistence on purpose: the catalog and stock are re-seeded at startup.

## Verification

- `verify.sh` passes
- You saw the read-only filesystem refuse a write
- You know which script deletes data

## Why it matters

The same practices that make the lab reliable on a laptop (small images, real health checks,
explicit dependencies, least privilege, resource limits) are the baseline for any containerised
service.

## Common mistakes

- **`sleep 30` instead of health checks.** Too long on a fast machine, too short on a slow one.
- **Running as root because it is easier.** A compromised process then owns the container.
- **Readiness that depends on the telemetry backend.** An observability outage becomes a business
  outage.
- **Forgetting `-v` is destructive.** `docker compose down -v` deletes your volumes.

## Challenge

Stop `postgres-db` with `docker compose stop postgres-db`. What do `curl -s localhost:8410/lab/status`
and `/ready` on order-service report, and what does a checkout return? Which signal shows the
problem first? Start it again with `docker compose start postgres-db`.

Next: [14 · Production Architecture](14-production.md)
