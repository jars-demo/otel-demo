# 03 · Understand Traces

> ⏱ 20 minutes · Read a trace like an engineer: kinds, attributes, status, exceptions, propagation.

## Goal

Read a checkout trace span by span, then make a request fail and follow the error from the span
where it started to the response the user saw.

## What you'll learn

- Trace, span, parent and child; span kinds SERVER, CLIENT and INTERNAL
- Attributes, events, status and recorded exceptions
- How context propagates between services with the `traceparent` header
- Duration vs self time, and the critical path

## Architecture

```text
api-gateway   SERVER  POST /api/checkout
              CLIENT  POST ───────── traceparent ─────────┐
order-service SERVER  POST /checkout  ◄───────────────────┘
              INTERNAL checkout, order.validate, ...
              CLIENT  POST ── traceparent ──► payment-service SERVER POST /payments
```

## Prerequisites

The lab is running and you placed a checkout in chapter 01.

## Steps

### 1. Read a healthy trace

Open the Trace Explorer at `http://localhost:3400/traces/`, set **Operation** to *Checkout*, and
open the newest trace. Select spans one at a time and read the panel on the right.

| Span | Kind | What it is |
|---|---|---|
| `POST /api/checkout` (api-gateway) | SERVER | The gateway handling the browser's request. The root span. |
| `POST` (api-gateway) | CLIENT | The gateway calling order-service. |
| `POST /checkout` (order-service) | SERVER | order-service handling that call. Same trace, new service. |
| `checkout`, `order.*` | INTERNAL | Manual spans for business steps. |
| `INSERT`, `UPDATE` | CLIENT | SQL statements, from the psycopg instrumentation. |
| `HGETALL GET`, `EVALSHA` | CLIENT | Redis commands, from the redis instrumentation. |

> [!TIP]
> Every network hop shows up as a **pair**: a CLIENT span in the caller and a SERVER span in the
> callee. The gap between them is network and queueing time.

### 2. Look at the attributes

On an `INSERT` span you will find:

```text
db.system.name   postgresql
db.namespace     shop
db.query.text    INSERT INTO orders (id, user_id, status, total_cents) VALUES (%s, %s, 'pending', %s)
server.address   postgres
server.port      5432
```

and on the `checkout` span, the business context set by hand:

```text
user.id          user-123
app.order.id     ord_47cad5296e544244
```

The query text contains `%s` placeholders, never the values: parameters are not captured. That
keeps personal data out of traces.

### 3. Make a request fail

```bash
curl -s -X PUT localhost:8410/lab/faults \
  -H 'Content-Type: application/json' \
  -d '{"changes":{"payment.fail_payments":true}}' > /dev/null

curl -s -i -X POST localhost:8400/api/checkout \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"user-123","items":[{"product_id":"prod-003","quantity":1}]}'
```

> **What it does:** Turns on the "payment provider times out" fault, then places an order.
> **Why:** To create an error you can follow through the trace.
> **Expected:** After about a second, `HTTP/1.1 502 Bad Gateway` and the whole chain of messages.

```text
HTTP/1.1 502 Bad Gateway
x-trace-id: 6066a8b05dda851d1355ebd36af1ed16

{"error":"order_service_failed","message":"order-service returned 502: payment-service returned 503: payment provider timeout after 800 ms"}
```

Turn the fault off again:

```bash
curl -s -X POST localhost:8410/lab/faults/reset > /dev/null
```

> **What it does:** Resets every fault in the lab.
> **Why:** Always clean up a fault before the next experiment.
> **Expected:** No output. The next checkout succeeds.

### 4. Follow the error

Open the failing trace. Red squares mark spans with status ERROR:

```text
POST /api/checkout                 ERROR   (502)
└── checkout.request               ERROR   exception: DependencyError
    └── POST /checkout             ERROR
        └── checkout               ERROR   exception: DependencyError
            ├── order.validate             ok
            ├── order.create               ok
            ├── order.reserve_inventory    ok
            ├── order.charge_payment       ERROR
            │   └── POST /payments         ERROR   (503)
            │       └── payment.process            ERROR
            │           └── payment.provider.authorize  ERROR  exception: PaymentProviderTimeout
            ├── POST /reservations/{order_id}/release   ok   <- stock given back
            └── UPDATE                     ok              <- order marked failed
```

The deepest span with status ERROR is where the failure *started*. Select
`payment.provider.authorize` and look at its **exception** event:

```text
exception.type        payment.main.PaymentProviderTimeout
exception.message     payment provider timeout after 800 ms
exception.stacktrace  Traceback (most recent call last): ...
```

## Code

An exception that escapes a span is recorded automatically: `start_as_current_span` adds the
`exception` event and sets status ERROR. From `services/payment/main.py`:

```python
with tracer.start_as_current_span("payment.provider.authorize") as provider:
    if faults.current.fail_payments:
        await asyncio.sleep(PROVIDER_TIMEOUT_MS / 1000)
        raise PaymentProviderTimeout(f"payment provider timeout after {PROVIDER_TIMEOUT_MS} ms")
```

A **business outcome** is not an error. Out of stock and a declined card are expected answers, so
`services/orders/checkout.py` catches them inside the span, records them as an attribute, and
re-raises *after* the span ended so its status stays OK:

```python
except CheckoutRejected as exc:
    span.set_attribute("app.checkout.outcome", exc.code)   # out_of_stock, payment_declined
    rejected = exc
...
raise rejected
```

### Context propagation, by hand

Send a request with your own `traceparent` header:

```bash
curl -s -i localhost:8400/api/products/prod-002 \
  -H 'traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
```

> **What it does:** Pretends to be an upstream service that already started trace
> `0af76519...` with span `b7ad6b71...`.
> **Why:** This header is all context propagation is. The FastAPI instrumentation reads it and
> makes its server span a child of `b7ad6b71...`.
> **Expected:** The response header `x-trace-id: 0af7651916cd43dd8448eb211c80319c`: the gateway
> joined *your* trace. In the Trace Explorer the trace is flagged incomplete, because the parent
> span `b7ad6b71...` was never sent by anyone.

## Verification

- You can name the kind of five different spans in a checkout trace
- In the failing trace you found `PaymentProviderTimeout` on `payment.provider.authorize`
- Your hand-made `traceparent` produced a trace with your id

## Why it matters

A trace turns "checkout fails" into "the payment provider timed out after 800 ms, inside
payment-service, while authorising order X, and stock was released correctly". Status and
exception events tell you where it broke; attributes tell you what it was working on.

## Common mistakes

- **Starting from the top.** The root span is ERROR in every failing trace. Look for the
  *deepest* ERROR span.
- **Marking business outcomes as errors.** A declined payment with status ERROR makes error-rate
  alerts lie.
- **Losing context across async boundaries or queues.** If a hop does not propagate
  `traceparent`, the trace splits in two.
- **Reading duration as cost.** A long span may be just waiting. Self time is what it spent
  itself (step 5 of chapter 11).

## Challenge

Turn on `inventory.error_every_n` with the value `2` and send four checkouts. Compare a failed
trace with a successful one. Which is the first span where they differ? Which spans never appear
in the failed one, and why?

Next: [04 · Add Metrics](04-metrics.md)
