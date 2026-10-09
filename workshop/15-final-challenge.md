# 15 · Final Incident Challenge

> ⏱ 30 minutes · INC-999: everything looks healthy. Find the root cause on your own.

## Goal

Investigate an incident with no hints unless you ask for them. Use everything from the workshop:
baseline, metrics, traces, self time, logs, and the saturation signals.

## What you'll learn

- Investigating when every dependency looks healthy
- Reading a gap in a trace as evidence
- Using connection pool metrics as a saturation signal
- Writing a complete incident summary

## Architecture

```text
api-gateway ─► order-service ─► inventory-service ─► redis      all healthy?
                     │       └─► payment-service ──► postgres   all healthy?
                     └─► postgres                               all healthy?
```

## Prerequisites

Chapters 09 to 12. No fault active: `curl -s -X POST localhost:8410/lab/faults/reset`.

## The incident

> Checkout latency has increased. Some checkouts fail with HTTP 502. Payment looks healthy.
> Inventory looks healthy. Database query times look normal. Nobody deployed anything.
> Find the root cause.

## Steps

### 1. Start it

Open `http://localhost:3400/incidents/final-challenge/` and click **Start investigation**. It sends
12 checkouts per second. In Incident Control the fault values are hidden while the challenge runs.

> **What it does:** Measures a baseline for 45 seconds, then injects the incident.
> **Why:** You will compare everything you find against that baseline.
> **Expected:** After about a minute, gateway p95 above 1 s and a small error rate.

### 2. Investigate

Work through the steps on the incident page. Try each step before opening its hint. Questions to
ask yourself:

- Which services are degraded, and which are not?
- If payment, inventory, Redis and PostgreSQL are all fast, where can order-service spend its time?
- In a slow trace, is there time inside an order-service span that no child span accounts for?
  What happens at the very start of a checkout?
- Which metric measures the thing that span cannot show? (Chapter 04 listed it. The Metrics page has
  a table for it.)
- What do the failed checkouts log?

### 3. Answer, fix, verify

Answer the root cause question. When the write-up appears, read the evidence and compare it with
yours. Apply the fix, wait 30 seconds, and verify recovery.

## Code

Do not read this until you have answered. The fault is in `services/orders/checkout.py`:

```python
if deps.faults.current.hold_connection_during_checkout:
    async with deps.db.connection() as held:          # borrowed for the WHOLE checkout,
        return await _checkout_steps(deps, request, held)   # including two network calls
```

and `services/orders/main.py` shrinks the pool to 2 while the fault is on. The time spent waiting
for a connection happens before any SQL runs, so no query span shows it; `services/common/db.py`
records it as `db.client.connection.wait_time`.

## Verification

- You named the root cause with at least three pieces of evidence (trace, metric, log)
- Recovery verification passed

## Incident summary

Write it as you would for your team:

```text
Symptom      checkout p95 rose from ~240 ms to over 1 s; a share of checkouts failed with 502
Evidence     self time at the start of the order-service checkout span; SQL, Redis, inventory and
             payment spans unchanged; db_client_connection_pending_requests > 0; wait p95 near 2 s;
             pool max 2; ERROR logs "timed out after 2s waiting for a database connection"
Root cause   order-service holds a pooled connection across the inventory and payment calls,
             with a pool of 2: at 12 checkouts/s requests queue for a connection
Remediation  borrow a connection per database step; restore the pool size; alert on pool wait time
Verification p95 back within 1.5x of baseline, errors under 2%, pool wait near zero
```

## Why it matters

Real incidents rarely announce themselves through a red dependency. When everything you can see is
healthy, the cause is in what you cannot see yet: a gap in a trace, a resource that is saturated, a
metric nobody looks at until they need it. Observability is having that data before you need it.

## Common mistakes

- **Blaming the database because the problem involves the database.** Each query is fast; the wait
  is for a connection.
- **Ignoring gaps.** A span with long self time and no children is evidence, not noise.
- **Stopping at "order-service is slow".** That is a location, not a root cause.

## Challenge

You have finished the workshop. Go back to the note you wrote in chapter 00 about your last
production problem. Which signals, spans and metrics would have found it, and how fast? Then
consider instrumenting one of your own services with what you learned in chapter 02.
