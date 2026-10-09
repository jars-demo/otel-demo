import type { Metadata } from 'next'

import { ServiceMapView } from '@/components/ServiceMapView'
import { PageHeader, Section } from '@/components/ui'
import { VERSIONS } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Architecture',
  description:
    'Four FastAPI services, PostgreSQL, Redis, Toxiproxy, the OpenTelemetry Collector, Tempo, Prometheus, Loki and Grafana: what each part does.',
  alternates: { canonical: '/architecture/' },
}

const CONTAINERS = [
  [
    'web',
    'nginx',
    'This site, built as static files. Proxies /api to the gateway and /lab to the lab-console.',
    '3400',
  ],
  [
    'api-gateway',
    'FastAPI',
    'The only service the browser calls. Validates input, routes, returns X-Trace-Id.',
    '8400',
  ],
  [
    'order-service',
    'FastAPI',
    'Creates orders and runs checkout: validate, create, reserve stock, charge, complete.',
    'internal',
  ],
  ['inventory-service', 'FastAPI', 'Catalog, stock levels and atomic reservations, stored in Redis.', 'internal'],
  [
    'payment-service',
    'FastAPI',
    'Authorizes payments against a sandboxed provider, records them in PostgreSQL.',
    'internal',
  ],
  ['postgres-db', 'PostgreSQL 18', 'Orders, order items and payments.', 'internal'],
  ['redis-db', 'Redis 8', 'Product catalog, stock counters and reservations.', 'internal'],
  [
    'toxiproxy',
    'Toxiproxy 2.12',
    'Answers as `postgres` and `redis` and forwards to the real ones; adds real network latency on demand.',
    'internal',
  ],
  [
    'otel-collector',
    `Collector ${VERSIONS.collector}`,
    'Receives OTLP from every service; one pipeline per signal.',
    '4317, 4318',
  ],
  ['tempo', `Tempo ${VERSIONS.tempo}`, 'Stores traces; derives service-graph and span metrics.', '3200'],
  ['prometheus', `Prometheus ${VERSIONS.prometheus}`, 'Stores metrics, received over OTLP and remote write.', '9090'],
  ['loki', `Loki ${VERSIONS.loki}`, 'Stores logs, received over OTLP.', '3100'],
  ['grafana', `Grafana ${VERSIONS.grafana}`, 'Explore and dashboards over all three, with trace/log links.', '3401'],
  [
    'lab-console',
    'FastAPI',
    'Lab tooling, not part of the system under observation: faults, incidents, load, queries for this site.',
    '8410',
  ],
]

const FLOW = `Browser
   │  POST /api/checkout
   ▼
api-gateway ──► order-service ──┬──► inventory-service ──► toxiproxy ──► redis-db
                                ├──► payment-service ────► toxiproxy ──► postgres-db
                                └────────────────────────► toxiproxy ──► postgres-db

every service ── OTLP/HTTP ──► otel-collector ──┬──► tempo       (traces)
                                                ├──► prometheus  (metrics)
                                                └──► loki        (logs)
                                       grafana ◄─┘  and this site, through lab-console`

export default function ArchitecturePage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Architecture" title="Small enough to understand completely">
        Four application services, two data stores and one telemetry pipeline. Small on purpose: you should be able to
        hold the entire system in your head while you debug it.
      </PageHeader>

      <Section title="The services">
        <ServiceMapView />
      </Section>

      <Section title="Requests and telemetry">
        <pre className="card overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">{FLOW}</pre>
      </Section>

      <Section title="A checkout, step by step">
        <ol className="grid gap-3 md:grid-cols-5">
          {[
            ['Validate', 'order-service merges duplicate lines and looks up current prices in inventory-service.'],
            ['Create', 'Inserts the order and its items in PostgreSQL with status pending.'],
            ['Reserve', 'inventory-service checks and decrements stock for every line in one Redis Lua script.'],
            ['Charge', 'payment-service authorizes the amount and records the payment.'],
            ['Complete', 'The order becomes completed. On failure, stock is released and the order marked failed.'],
          ].map(([title, text], i) => (
            <li key={title} className="card p-4 text-sm">
              <span className="font-mono text-xs text-accent">{i + 1}</span>
              <p className="font-semibold">{title}</p>
              <p className="mt-1 text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Every container">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Container</th>
                <th>Built on</th>
                <th>Role</th>
                <th>Host port</th>
              </tr>
            </thead>
            <tbody>
              {CONTAINERS.map(([name, tech, role, port]) => (
                <tr key={name}>
                  <td className="font-mono font-semibold">{name}</td>
                  <td>{tech}</td>
                  <td>{role}</td>
                  <td className="font-mono">{port}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted">
          Host ports bind to 127.0.0.1 only. The whole lab fits in about 2.5 GB of memory; every container has a memory
          limit.
        </p>
      </Section>

      <Section title="Why these choices">
        <div className="grid gap-4 md:grid-cols-2">
          {[
            [
              'Python and FastAPI',
              'Mature, stable OpenTelemetry SDK for traces and metrics, library instrumentation for every dependency used here, and code most readers can follow.',
            ],
            [
              'Collector in the middle',
              'Services only know OTLP and one endpoint. Backends can change without touching application code, and policy (scrubbing, sampling, batching) lives in one place.',
            ],
            [
              'Tempo, Prometheus, Loki, Grafana',
              'Open source, run locally, and all three accept OTLP natively, so no vendor-specific exporter is involved.',
            ],
            [
              'Toxiproxy for network faults',
              'Latency is added on the real network path, so the Redis and PostgreSQL client spans really are slow. Nothing in the services fakes it.',
            ],
            [
              'A separate lab-console',
              'Fault control, load generation and backend queries live outside the system under observation, so they never pollute the telemetry you investigate.',
            ],
            [
              'Not the official OpenTelemetry Demo',
              'The official demo is a large polyglot reference application. This lab is deliberately small and incident-focused, so you can understand every part.',
            ],
          ].map(([title, text]) => (
            <div key={title} className="card p-4">
              <p className="font-semibold">{title}</p>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
