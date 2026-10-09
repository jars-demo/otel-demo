# 09 · Investigate an Incident

> ⏱ 25 minutes · INC-001 and INC-002: from symptom to root cause, with evidence.

## Goal

Run two incidents the way an on-call engineer would: start from the symptom, use metrics to scope
it, traces to locate it, logs to explain it, then fix and verify recovery against the baseline.

## What you'll learn

- A repeatable investigation method
- Reading a latency incident (INC-001) and an error incident (INC-002)
- Using the lab's baseline, fix and verify cycle
- Writing down the root cause with its evidence

## Architecture

```text
Incident Lab ─► lab-console: start traffic ─► wait 45 s ─► record baseline ─► inject faults
you          ─► Metrics (what changed) ─► Traces (where) ─► Logs (why) ─► answer
you          ─► Apply fix ─► wait 30 s ─► Verify recovery (Prometheus vs baseline)
```

## Prerequisites

Chapters 03 to 05. The lab is running and no fault is active (`curl -s -X POST
localhost:8410/lab/faults/reset`).

## The method

1. **Symptom.** What do users see? Since when?
2. **Scope with metrics.** Which services, which operations, latency or errors, how much worse
   than the baseline?
3. **Locate with traces.** Open a bad trace. Follow the critical path down. Find the deepest span
   that holds the time, or the deepest span with status ERROR.
4. **Explain with logs.** What did that component report, in that trace?
5. **Root cause.** One sentence, plus the evidence that proves it.
6. **Fix, then verify** against the baseline, not against "looks fine".

Write each step down as you go. A timeline with evidence is what a good incident review is made
of.

## Steps

### 1. INC-001: Slow Checkout

Open `http://localhost:3400/incidents/slow-checkout/` and click **Start investigation**.

> **What it does:** The lab starts 3 checkouts per second, measures normal behaviour for 45
> seconds, records a baseline, then injects the incident. You are not told what changed.
> **Why:** Real incidents arrive without an explanation. The baseline is what lets you say "worse
> than normal" with numbers.
> **Expected:** The phase bar moves from *Measure baseline* to *Investigate*. The baseline line
> shows something like `p95 240 ms · errors 0% · 3.0 req/s`.

The same through the API, if you prefer the terminal:

```bash
curl -s -X POST localhost:8410/lab/incidents/INC-001/start
curl -s localhost:8410/lab/incidents/active
```

> **What it does:** Starts the incident, then shows its phase and baseline.
> **Why:** Everything the page does is a call to the lab-console.
> **Expected:** `"phase":"baseline"`, and after 45 seconds `"phase":"active"` with a `baseline`.

Now investigate. Work through the steps on the incident page; open each hint only after trying.
What you should find:

- **Metrics:** api-gateway, order-service and inventory-service p95 jump to about 3.4 s. Errors
  stay at 0%. payment-service is unchanged.
- **Traces:** in a checkout slower than 2000 ms, the critical path runs through
  `order.validate` and `order.reserve_inventory`. Under each, a Redis CLIENT span takes about
  1500 ms. The inventory spans themselves have almost no self time.
- **Logs:** nothing unusual. Slow is not broken.

Answer the root cause question, then click **Apply fix**, wait about 30 seconds, and click
**Verify recovery**. The lab compares the last 30 seconds with the baseline:

```text
✓ All faults are off
✓ p95 latency under 460 ms (baseline 240 ms)
✓ Error rate under 2%
```

If p95 still fails, the 30-second window still contains slow requests. Wait and verify again.

### 2. INC-002: Payment Failure

Open `http://localhost:3400/incidents/payment-failure/` and start it. This one fails loudly:

- **Metrics:** the gateway's error rate rises, but not to 100%: browsing still works. Checkouts
  fail.
- **Traces:** filter *Errors only*. The deepest ERROR span is `payment.provider.authorize` with an
  `exception` event: `PaymentProviderTimeout: payment provider timeout after 800 ms`. Every span
  above it is ERROR too. Notice `POST /reservations/{order_id}/release`: order-service gave the
  stock back.
- **Logs:** three ERROR lines with the same trace id, one from each of payment-service,
  order-service and api-gateway, each adding its own context.

Fix, wait, verify.

## Code

How the verification is computed (`services/lab/incidents.py`):

```python
limit = baseline["p95_ms"] * RECOVERY_P95_FACTOR + RECOVERY_P95_SLACK_MS   # 1.5x + 100 ms
checks.append({"name": f"p95 latency under {limit:.0f} ms ...", "passed": current["p95_ms"] <= limit})
checks.append({"name": "Error rate under 2%", "passed": error_ratio <= RECOVERY_MAX_ERROR_RATIO})
```

Both numbers come from Prometheus (`histogram_quantile` and the 5xx share over 30 seconds). Recovery
is a measurement, not an opinion.

## Verification

- INC-001: you identified Redis latency, with the Redis spans as evidence, and verification passed
- INC-002: you identified the payment provider timeout from the exception event, and verification
  passed
- Your notes contain symptom, evidence, root cause, fix and verification for both

## Why it matters

Under pressure, people jump to the first plausible cause. A method, starting from data and ending
with verified recovery, is faster on average and much faster in the worst case. Most of the method
is choosing the right signal for each question.

## Common mistakes

- **Starting with logs.** Without scope (metrics) and location (traces), you are reading
  thousands of lines.
- **Stopping at the first slow span.** Keep following the critical path down; the slowest span is
  usually the deepest one that is not just waiting.
- **Declaring victory too early.** A fix is verified when the numbers are back near the baseline,
  not when one request looks fast.
- **Ignoring side effects.** In INC-002, did the failed checkouts leave stock reserved? The trace
  answers that.

## Challenge

For INC-002, write a short incident summary (five lines): what users saw, when it started, the root
cause, the evidence, and how you verified the fix. Then answer: what alert would have caught this
in under a minute, and on which metric?

Next: [10 · Trace a Database Problem](10-database-debugging.md)
