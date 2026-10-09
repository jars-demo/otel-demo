## Telemetry can leak what your application protects

Telemetry is copied out of the application, sent over the network, stored for days, and read by
more people than the production database is. Anything that ends up in an attribute, a log line or
a metric label goes everywhere telemetry goes. Treat it as data with the same rules as the rest.

### Never collect

- passwords and password hashes
- access tokens, session cookies, API keys, signing secrets
- payment details: card numbers, CVV, bank accounts
- personal data you do not need: emails, phone numbers, addresses, government ids
- request or response bodies, unless you have checked exactly what is in them

```text
BAD   user.password = "hunter2"
BAD   user.email = "jane@example.com"           (on a metric label, also a cardinality bomb)
BAD   http.request.header.authorization = "Bearer eyJhbGciOi..."

GOOD  user.id = "user-123"                        (pseudonymous)
GOOD  app.payment.outcome = "declined"            (outcome, not the card)
GOOD  error.type = "PaymentProviderTimeout"
```

In this lab the payment service records the amount, currency and outcome of a payment, never any
card data (there is none to record), and logs never include request bodies.

## Defence in depth

1. **At the source.** Decide what each span and log records. This is the only layer that knows
   what a value means. Instrumentation libraries do not capture headers or bodies unless you
   configure them to.
2. **In the Collector.** A central place to enforce policy for every service. This lab's
   pipeline runs an `attributes/scrub` processor that deletes `user.email`, `user.password`,
   `http.request.header.authorization` and `http.request.header.cookie` from traces and logs,
   even though no service sends them today. The safety net is for the day someone does.
   The `redaction` and `transform` processors can mask values by pattern (for example anything
   that looks like a card number).
3. **In the backend.** Access control on who can query what, and retention that deletes data
   when it is no longer needed.

```yaml
processors:
  attributes/scrub:
    actions:
      - key: user.email
        action: delete
      - key: http.request.header.authorization
        action: delete
```

## Transport and access

| Control               | In this lab                                  | In production                                                     |
| --------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| Encryption in transit | None: plain OTLP on a private Docker network | TLS on every hop, mTLS between Collectors                         |
| Authentication        | None: Grafana allows anonymous admin         | OTLP receivers require auth (bearer token, mTLS); SSO for Grafana |
| Network exposure      | Ports bound to 127.0.0.1 only                | Collectors reachable only from workloads that need them           |
| Authorization         | Anyone with the URL                          | Per-team or per-tenant access to traces and logs                  |
| Retention             | 72 hours                                     | A deliberate, documented policy per signal                        |
| Least privilege       | Single shared database user                  | Separate credentials per service, read-only where possible        |

> [!WARNING]
> The settings in this repository are for a local lab. Anonymous Grafana admin, plain-text OTLP
> and a well-known database password (`shop`/`shop`) must never be copied to a shared or public
> environment.

## Fault injection is safe by construction

The fault controls in the Incident Lab only change switches inside this lab's own services and
Toxiproxy on the Docker network. They are bounded (latency at most 5 s, error rates capped), they
never execute commands, never touch the host, and never send traffic anywhere but the lab's own
api-gateway. The load generator is capped at 20 requests per second for 15 minutes. One reset
clears everything.
