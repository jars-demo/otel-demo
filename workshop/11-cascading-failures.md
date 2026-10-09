# 11 · Diagnose Cascading Latency

> ⏱ 20 minutes · INC-004 and INC-005: intermittent errors, self time, and latency that spreads.

## Goal

Diagnose an intermittent failure by comparing traces, then a slowdown that makes three services
look guilty when only one is. Learn to read self time and the critical path.

## What you'll learn

- Comparing a failed trace with a successful one to find where they diverge
- Why latency cascades upward, and why the loudest alert is often the furthest from the cause
- Duration vs self time; the critical path; the bottleneck span
- How timeouts and retries can turn a slowdown into an outage

## Architecture

```text
user ─► api-gateway ─► order-service ─► inventory-service ─► redis
          waits          waits            SLOW (own code)     fast
```

## Prerequisites

Chapters 09 and 10. No fault active.

## Steps

### 1. INC-004: one checkout in three fails

Start `http://localhost:3400/incidents/inventory-failure/`. Once it is active:

- **Metrics:** about a third of checkouts fail. The error rate is steady, not bursty: something
  deterministic, not load-related.
- **Traces:** open an error trace, then a successful one from the same minute. The failed trace
  stops after `order.reserve_inventory`: `inventory.reserve` has status ERROR and an exception
  event `StockLedgerUnavailable`. payment-service never appears.
- **Logs:** filter ERROR and inventory-service. Each line links to a failed trace.

> [!TIP]
> For intermittent problems, put a bad trace next to a good one and find the **first** span where
> they differ. Everything after that point is consequence.

Fix and verify.

### 2. INC-005: three services slow at once

Start `http://localhost:3400/incidents/cascading-latency/`. Three services alert together. Each
"team" says it is only waiting on someone else. They are all telling the truth except one.

Open a checkout slower than 2000 ms. A checkout runs its steps one after another, so every step is
on the critical path; follow the branch that holds the time:

```text
span                          duration   self time
POST /api/checkout            2.18 s       1 ms    waiting
└ checkout (order-service)    2.17 s       1 ms    waiting
  └ order.reserve_inventory   2.01 s       1 ms    waiting
    └ POST /reservations      2.00 s       1 ms    waiting
      └ inventory.reserve     2.00 s    2.00 s     <- the time is spent HERE
        └ EVALSHA (redis)     1.2 ms     1.2 ms    fast
```

The Trace Explorer marks `inventory.reserve` as the **bottleneck**: the span on the critical path
with the most self time. Duration tells you who was *involved*; self time tells you who was
*working*.

Compare with INC-001: there the time sat inside the Redis span. Here Redis is fast and the time is
in inventory-service's own code.

Fix and verify.

## Code

How the Trace Explorer computes self time (`services/lab/traces.py`): a span's duration minus the
union of its children's intervals.

```python
def _self_time(span, kids):
    start, end = span["start_ns"], span["end_ns"]
    covered, cursor = 0, start
    for kid in sorted(kids, key=lambda k: k["start_ns"]):
        k_start, k_end = max(kid["start_ns"], cursor), min(kid["end_ns"], end)
        if k_end > k_start:
            covered += k_end - k_start
            cursor = k_end
    return max(0, (end - start) - covered)
```

And the critical path: walk back from the end of a span, take the child that finished last, then
the child that finished before that one started, and so on.

## Timeouts and retries

In this lab, order-service waits up to 6 seconds for inventory-service, so a 2-second slowdown stays
a slowdown. Now imagine a 1-second timeout with one retry:

1. inventory-service takes 2 s, order-service times out at 1 s and retries
2. the retry also takes 2 s and times out: the checkout fails after 2 s anyway
3. inventory-service now receives **twice** the requests it can handle, gets slower still

A slow dependency plus aggressive retries is a classic path from "slow" to "down". Timeouts should
follow the caller's own budget (its SLO), retries should be few, with backoff, and only for
idempotent operations. The reservation here is idempotent by design (`services/inventory/store.py`
returns early if the order already holds one), so a retry is safe.

## Verification

- INC-004: you found the first divergence between a good and a bad trace
- INC-005: you named the bottleneck by self time, not by duration
- Both verified recovered

## Why it matters

In a dependency chain, every caller inherits its callees' latency and errors. Paging the team that
owns the loudest alert wastes the first half hour of most incidents. Self time and the critical
path point at the team that can actually fix it.

## Common mistakes

- **Blaming the service with the highest latency.** It is usually the top of the chain.
- **Looking only at one trace.** One trace can be an outlier; confirm with metrics that the
  pattern is general.
- **Retrying everything.** Retries multiply load exactly when a dependency is struggling.

## Challenge

INC-005 slowed only checkout, not browsing, although both call inventory-service. Using only
traces, prove which inventory endpoint is slow and which is not. Then predict what the service map
shows for the `api-gateway → inventory-service` edge, and check.

Next: [12 · Sampling and Cost](12-sampling.md)
