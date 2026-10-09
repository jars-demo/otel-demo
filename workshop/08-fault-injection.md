# 08 · Break the System

> ⏱ 15 minutes · Baselines, controlled faults, and how Toxiproxy makes latency real.

## Goal

Measure normal behaviour, inject one fault, measure the difference, and put everything back. Learn
every fault the lab can inject and how each one works.

## What you'll learn

- Why every investigation starts with a baseline
- The lab's eight faults: service faults and network faults
- How Toxiproxy adds latency on the real network path
- How to inject, observe and reset faults safely

## Architecture

```text
inventory-service ──► redis:6379 ═══ toxiproxy ═══► redis-db:6379
order-service     ──► postgres:5432 ═ toxiproxy ═══► postgres-db:5432
payment-service   ──► postgres:5432 ═ toxiproxy ═══► postgres-db:5432
                                    ▲
lab-console ── adds/removes "latency" toxics (Toxiproxy API :8474)
lab-console ── PUT /internal/faults on each service (in-process switches)
```

`redis` and `postgres` are network aliases of the Toxiproxy container. To the services it looks
exactly like the real thing, which is why the Redis and SQL client spans get slower: the latency is
on the wire.

## Prerequisites

The lab is running.

## The faults

| Fault | Kind | What happens |
|---|---|---|
| `gateway.latency_ms` | service | The gateway waits before handling every `/api` request |
| `gateway.error_rate_percent` | service | The gateway rejects that share of requests with 503 |
| `redis.latency_ms` | network | Toxiproxy delays every command sent to Redis |
| `postgres.latency_ms` | network | Toxiproxy delays every query sent to PostgreSQL |
| `payment.fail_payments` | service | The payment provider times out; payment-service answers 503 |
| `inventory.error_every_n` | service | Every n-th stock reservation fails with 500 |
| `inventory.latency_ms` | service | inventory-service spends that long in its own reservation code |
| `orders.hold_connection_during_checkout` | service | order-service holds a DB connection across network calls, pool of 2 |

Every fault is bounded (latency at most 5 s, error rates capped), deterministic (`every_n` fails
exactly every n-th call, so incidents reproduce), local to the Docker network, and reversible with
one reset. Restarting a service clears its faults.

## Steps

### 1. Measure the baseline

```bash
for i in 1 2 3; do
  curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' -X POST localhost:8400/api/checkout \
    -H 'Content-Type: application/json' \
    -d '{"user_id":"user-123","items":[{"product_id":"prod-002","quantity":1}]}'
done
```

> **What it does:** Places three orders and prints each status code and total time.
> **Why:** You cannot tell whether 2 seconds is slow until you know what normal is.
> **Expected:** `201` and well under half a second each. In our run: 0.45 s, 0.41 s, 0.43 s.

### 2. Inject Redis latency

```bash
curl -s -X PUT localhost:8410/lab/faults \
  -H 'Content-Type: application/json' \
  -d '{"changes":{"redis.latency_ms":1000}}'
```

> **What it does:** Asks the lab-console to add a 1000 ms latency toxic to the Redis proxy.
> **Why:** A slow cache is one of the most common causes of slow requests.
> **Expected:** The fault list as JSON, with `"redis.latency_ms"` now `1000`.

### 3. Measure the difference

Run the loop from step 1 again, then one browse request:

```bash
curl -s -o /dev/null -w 'products %{http_code} %{time_total}s\n' localhost:8400/api/products
```

> **What it does:** Repeats the checkouts, then fetches the catalog.
> **Why:** Same requests, one change: the difference is the fault's effect.
> **Expected:** Checkouts take about **2.4 s** (one second slower per Redis round trip, and a
> checkout makes two: the price lookup and the reservation). The catalog takes about **1.2 s**
> (one round trip).

```text
201 2.391622s
201 2.412491s
201 2.371978s
products 200 1.215117s
```

Now open one of the slow checkouts in the Trace Explorer (filter *Slower than 1000 ms*). The two
Redis CLIENT spans, `HGETALL GET` and `EVALSHA`, each take about 1000 ms. The trace says exactly
where the time went.

### 4. Reset

```bash
curl -s -X POST localhost:8410/lab/faults/reset > /dev/null
```

> **What it does:** Turns every fault off: service switches back to defaults, Toxiproxy toxics
> removed.
> **Why:** Leave the lab clean for the next experiment.
> **Expected:** No output. Checkouts are fast again.

### 5. The same, with buttons

Open `http://localhost:3400/incidents/#control`. **Incident Control** lists every fault with its
current value, lets you change it, sends traffic, and places single orders with a link to their
trace.

## Code

Toxiproxy is configured with two proxies (`infra/toxiproxy/toxiproxy.json`):

```json
[
  { "name": "redis",    "listen": "0.0.0.0:6379", "upstream": "redis-db:6379",    "enabled": true },
  { "name": "postgres", "listen": "0.0.0.0:5432", "upstream": "postgres-db:5432", "enabled": true }
]
```

The lab-console adds latency with one call to Toxiproxy's API (`services/lab/faults.py`). The
toxic acts on the **upstream** stream, the bytes going to Redis, so each round trip is delayed
exactly once:

```python
toxic = {"name": "latency", "type": "latency", "stream": "upstream",
         "attributes": {"latency": latency_ms, "jitter": 0}}
await self.http.post(f"{self.toxiproxy_url}/proxies/{proxy}/toxics", json=toxic)
```

Service faults are small, validated pydantic models each service exposes on `/internal/faults`
(`services/common/faults.py`). That path is excluded from tracing, so flipping a switch never
shows up in the traces you investigate.

## Verification

- Baseline checkouts were fast; with 1000 ms of Redis latency they took about 2.4 s
- The slow trace shows two Redis spans of about 1 s
- After the reset, `curl -s localhost:8410/lab/faults` shows every value as `0` or `false`

## Why it matters

Observability is about **change**: what is different from normal, and since when. Measuring a
baseline before you break something, and measuring again after you fix it, is the habit that turns
debugging into engineering. Controlled fault injection (chaos engineering, in its grown-up form)
is how teams practise before real incidents happen.

## Common mistakes

- **No baseline.** "It takes 2.4 s" means nothing without "it normally takes 0.4 s".
- **Forgetting to reset.** The next experiment will be confusing. Reset after every fault.
- **Faking latency with a sleep in the service.** The span that holds the time would be the wrong
  one. Toxiproxy puts it where a real network problem would.
- **Injecting faults in shared environments.** This lab's faults only reach its own Docker network.

## Challenge

Predict, then measure: with `postgres.latency_ms` set to 200, how much slower is one checkout?
Count the SQL spans in a normal checkout trace first, multiply, and compare with what you measure.
If your prediction is short, look at the **self time** of `order.create` in the slow trace. Which
round trips does no span show? (Hint: `order.create` runs inside a transaction.)

Next: [09 · Investigate an Incident](09-incident-response.md)
