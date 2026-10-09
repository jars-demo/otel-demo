# 10 · Trace a Database Problem

> ⏱ 20 minutes · INC-003: database spans, query text, database metrics, and what spans do not show.

## Goal

Diagnose a slow database from the application's side: the SQL client spans, their attributes,
the database client metrics, and the time no span accounts for.

## What you'll learn

- Reading `db.*` attributes on SQL spans
- Telling "an expensive query" from "a slow path to the database"
- `db.client.operation.duration` and the connection pool metrics
- Why self time on a parent span can be hidden round trips

## Architecture

```text
order-service ── INSERT/UPDATE ──► postgres (toxiproxy) ──► postgres-db
payment-service ─ INSERT ─────────► postgres (toxiproxy) ──► postgres-db
                                       ▲ INC-003 adds 300 ms per round trip here
```

## Prerequisites

Chapter 09. No fault active.

## Steps

### 1. Start INC-003

Open `http://localhost:3400/incidents/database-latency/` and click **Start investigation**. Read the
symptom: order creation is slow, browsing is fast, "the database team says CPU is low".

### 2. Scope it

On the Metrics page: order-service and payment-service are degraded and **postgres** is unhealthy
on the service map. inventory-service and redis are healthy. GET `/api/products` (no database
involved) stays fast.

Ask Prometheus directly how long SQL statements take, by operation:

```bash
curl -s -G localhost:9090/api/v1/query \
  --data-urlencode 'query=histogram_quantile(0.95, sum by (le, service_name, db_operation_name) (rate(db_client_operation_duration_seconds_bucket[1m])))'
```

> **What it does:** p95 duration of every SQL operation, per service, from the
> `db.client.operation.duration` histogram the psycopg instrumentation records.
> **Why:** If one statement were slow, one operation would stand out. If everything rose by the
> same amount, the path to the database is slow.
> **Expected:** Every operation (`INSERT`, `UPDATE`) above 0.3 s, in both services (about 0.4 s in
> our run: the 300 ms delay plus interpolation inside the 0.3 to 0.4 s bucket). A `SELECT` row
> showing `NaN` just means no SELECT ran in the last minute.

### 3. Read the spans

Open a checkout slower than 1500 ms. Select an `INSERT` span:

```text
db.system.name   postgresql
db.namespace     shop
db.query.text    INSERT INTO orders (id, user_id, status, total_cents) VALUES (%s, %s, 'pending', %s)
server.address   postgres
duration         about 300 ms
```

A single-row insert by primary key into a small table does not take 300 ms of database work. Every
SQL span grew by the same fixed amount, whatever the statement: that is the signature of latency
between the application and the database.

### 4. Find the time no span shows

Select `order.create`. Its duration is about four round trips, but it has only two INSERT
children. The rest is **self time**: the `BEGIN` and `COMMIT` of the transaction, which the
instrumentation does not record as spans. When a parent has self time it should not have, look
for work nobody instrumented.

### 5. Fix and verify

Apply the fix, wait 30 seconds, verify recovery.

## Code

The order is written in one transaction (`services/orders/repository.py`). Four round trips:
BEGIN, INSERT order, INSERT items (batched with `executemany`), COMMIT:

```python
async with conn.transaction():
    await conn.execute("INSERT INTO orders (...) VALUES (%s, %s, 'pending', %s)", (...))
    async with conn.cursor() as cur:
        await cur.executemany("INSERT INTO order_items (...) VALUES (%s, %s, %s, %s)", rows)
```

With 300 ms per round trip, round trips are what you pay for. That is why batching statements
(`executemany`) and avoiding chatty access patterns (one query per item, the "N+1" problem) matter
more on a slow network than on a fast one.

## Verification

- You showed with the `db_client_operation_duration_seconds` query that every operation slowed
  equally
- You explained the self time of `order.create`
- Recovery verification passed

## Why it matters

"The database is slow" and "the network to the database is slow" need different people and
different fixes. Database-side dashboards (CPU, slow query log) would have looked normal here. The
application's view of each query is what tells the two apart.

## Common mistakes

- **Blaming the query because it is in the slow span.** Check whether *every* query slowed down.
- **Capturing query parameters.** They often contain personal data. This lab records the query
  text with placeholders only.
- **Ignoring self time.** Uninstrumented round trips, lock waits and connection waits all hide
  there.

## Challenge

With `postgres.latency_ms` at 300, how long does `GET /api/orders/{id}` take? Look up an order id
from any checkout response, call it, and explain the duration from its trace. How many round trips
does it make, and could it make fewer?

Next: [11 · Diagnose Cascading Latency](11-cascading-failures.md)
