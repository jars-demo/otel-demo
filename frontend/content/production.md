## From one laptop to production

This lab runs one Collector and single-binary backends on a laptop. The concepts are the same in
production; the shape is not. A typical layout has two tiers of Collectors:

```text
 Application  ── OTel SDK (traces, metrics, logs)
     │  OTLP over localhost or the node network
     ▼
 Collector AGENT    one per host or node (Kubernetes DaemonSet) or a sidecar
     │  adds host and Kubernetes metadata, batches, applies cheap filters
     │  OTLP with TLS
     ▼
 Collector GATEWAY  a horizontally scaled pool behind a load balancer
     │  central policy: tail sampling, redaction, routing, rate limits, auth
     ▼
 Observability backends   traces · metrics · logs (self-hosted or a vendor)
```

### Agent vs gateway

|               | Agent                                                                               | Gateway                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Runs          | Next to the workload (per node or sidecar)                                          | As a shared, scaled service                                                                             |
| Good for      | Local enrichment (`k8sattributes`, host metrics), fast hand-off so apps never block | Policy in one place, tail sampling, routing to several backends, holding credentials                    |
| Failure scope | One node                                                                            | Everything, so it must be highly available                                                              |
| Tail sampling | No: it sees only part of each trace                                                 | Yes, if every span of a trace reaches the same instance (a `loadbalancing` exporter routes by trace id) |

## What changes

| Concern              | Workshop                        | Production                                                                                     |
| -------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| Collectors           | One container                   | Agents plus a highly available gateway pool                                                    |
| Batching             | `batch` processor, 2 s          | Batching plus persistent queues sized from measured throughput                                 |
| Retries and queues   | Exporter defaults, in memory    | `sending_queue` with a file storage extension so a restart does not lose data; bounded retries |
| Backpressure         | `memory_limiter`                | `memory_limiter`, plus autoscaling and alerts on refused data                                  |
| Transport security   | Plain OTLP on a private network | TLS everywhere, mTLS between tiers                                                             |
| Authentication       | None                            | Authenticated receivers, per-tenant credentials, secrets from a vault                          |
| Network boundaries   | 127.0.0.1 ports                 | Private networks, egress allow-lists, no public receivers                                      |
| Backends             | Single binaries, local disk     | Distributed deployments on object storage, replicated                                          |
| Retention            | 72 hours                        | Per signal and per tenant: raw traces for days, metrics for months                             |
| Sampling             | Keep everything                 | Head sampling in SDKs, tail sampling at the gateway for errors and slow requests               |
| Cardinality          | Small and controlled            | Limits in the backend, label allow-lists, dropping in the Collector                            |
| Alerting             | None                            | SLO burn-rate alerts on RED metrics and saturation                                             |
| Access control       | Anonymous Grafana               | SSO, roles, per-team data access                                                               |
| Cost                 | Your laptop                     | A budget: volume, retention and cardinality are engineering decisions                          |
| The Collector itself | Not monitored                   | Monitored: accepted, refused, dropped and queue-size metrics                                   |

## Sampling in production

Keeping every trace is rarely affordable at scale. Two families of sampling:

- **Head sampling** decides when a trace starts, in the SDK (for example a
  `ParentBased(TraceIdRatioBased(0.1))` sampler keeps 10% and makes downstream services follow
  the caller's decision). Cheap, but it decides before anyone knows whether the request will
  fail.
- **Tail sampling** decides once the trace is complete, in a gateway Collector with the
  `tail_sampling` processor. It can keep every error and every slow trace plus a small share of
  the rest. It costs memory (whole traces are buffered) and needs trace-aware load balancing.

Most teams combine them, and keep **metrics unsampled**: metrics are aggregated in the SDK, so
their cost does not grow with traffic the way spans do. When traces are sampled, dashboards built
from spans must account for it; RED metrics from the SDK do not have that problem.

## Alerting on what users feel

Alert on symptoms, not causes: a burn rate on the checkout SLO, error ratio, p99 latency. Use
traces and logs to find the cause once an alert fires, which is exactly what the Incident Lab
practises. Alerting on every CPU spike and every ERROR log line produces noise that teaches
people to ignore pages.

## Before you copy anything from this repository

The lab is deliberately simple and deliberately open. Before reusing a piece of it, add TLS and
authentication, remove anonymous access, replace the demo credentials, set real resource limits,
decide retention, and monitor the Collector. See the [Security](/security/) page.
