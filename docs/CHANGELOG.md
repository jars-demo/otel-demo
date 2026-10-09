# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-09

### Added

- Four instrumented FastAPI services (api-gateway, order-service, inventory-service,
  payment-service) on Python 3.13 with OpenTelemetry Python 1.45.1: library instrumentation for
  FastAPI, httpx, Redis and psycopg, manual business spans, stable HTTP and database semantic
  conventions, RED and business metrics, database connection pool metrics, and JSON logs with
  trace context exported over OTLP.
- OpenTelemetry Collector 0.162.0 with one pipeline per signal to Tempo 3.1.0, Prometheus 3.15.0
  (native OTLP) and Loki 3.7.8 (native OTLP), plus a validated tail sampling variant.
- Grafana 13.2.3 with linked data sources (trace to logs, logs to trace, metrics to trace) and a
  provisioned Service Health dashboard.
- Toxiproxy in front of Redis and PostgreSQL for real network latency faults.
- The lab-console: bounded fault control, capped Poisson load generation, incident runs with a
  measured baseline and Prometheus-based recovery verification, and Tempo, Prometheus and Loki
  queries with span self time, critical path and bottleneck detection.
- Six incidents: slow checkout, payment failure, database slowdown, inventory failure, cascading
  latency, and a final connection pool exhaustion challenge.
- A Next.js website with the Incident Lab, Trace Explorer, Metrics dashboard, Log Explorer,
  Collector pipeline visualiser, concept, security, production and FAQ pages, and a static public
  build that shows no invented data.
- Sixteen workshop chapters with verified commands and outputs.
- Hardened multi-stage images, Compose with health-checked startup, memory limits and local-only
  ports, and start, stop, reset, load-test and verify scripts.
- Unit and integration tests, and a CI workflow with linting, tests, builds, configuration
  validation, an end-to-end stack job and a Trivy scan.

[Unreleased]: https://github.com/jars-demo/otel-demo/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/jars-demo/otel-demo/releases/tag/v1.0.0
