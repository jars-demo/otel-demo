'use client'

import { useState } from 'react'

type Stage = { id: string; label: string; sub: string; what: string; why: string; data: string; config?: string }

// Mirrors infra/otel/collector.yaml. If the config changes, change this too.
const STAGES: Stage[] = [
  {
    id: 'app',
    label: 'Application',
    sub: 'OTel SDK in each service',
    what: 'The SDK creates spans, records metric measurements and turns log calls into log records. A batch processor in the SDK buffers them and an OTLP exporter sends them.',
    why: 'Instrumentation belongs in the application: only it knows when a request starts, which order it is for, and what failed.',
    data: 'Spans, metric points, log records, each with the service Resource (service.name, service.version, deployment.environment.name).',
  },
  {
    id: 'otlp',
    label: 'OTLP',
    sub: 'HTTP/protobuf :4318',
    what: 'The OpenTelemetry Protocol: one wire format for all three signals. The services use OTLP over HTTP; the Collector also listens for OTLP over gRPC on :4317.',
    why: 'A vendor-neutral protocol means the application never knows or cares which backend stores its telemetry.',
    data: 'POST /v1/traces, /v1/metrics and /v1/logs with protobuf bodies.',
  },
  {
    id: 'receiver',
    label: 'Receiver',
    sub: 'otlp',
    what: 'Accepts telemetry and converts it into the Collector’s internal format. One receiver can feed several pipelines.',
    why: 'Receivers are how data gets in. Others exist for Prometheus scraping, host metrics, log files, Kafka and more.',
    data: 'Everything the services send, unchanged.',
    config:
      'receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: 0.0.0.0:4317\n      http:\n        endpoint: 0.0.0.0:4318',
  },
  {
    id: 'processor',
    label: 'Processors',
    sub: 'memory_limiter · attributes · batch',
    what: 'Run in order on everything that passes. memory_limiter refuses data before the Collector runs out of memory, attributes/scrub deletes attributes that must never be stored, batch groups items into fewer, larger exports.',
    why: 'Policy lives in one place instead of in every service: protection, redaction, sampling, enrichment, batching.',
    data: 'The same signals, minus scrubbed attributes, grouped into batches of up to 1024 items or 2 s.',
    config:
      'processors:\n  memory_limiter:\n    check_interval: 1s\n    limit_percentage: 80\n  attributes/scrub:\n    actions:\n      - key: user.email\n        action: delete\n  batch:\n    send_batch_size: 1024\n    timeout: 2s',
  },
  {
    id: 'exporter',
    label: 'Exporters',
    sub: 'otlp_grpc · otlp_http · debug',
    what: 'Send each pipeline’s output somewhere. Every exporter has its own queue and retries, so a slow backend does not block the others.',
    why: 'Swapping or adding a backend is a Collector change, not an application release.',
    data: 'Traces as OTLP/gRPC to Tempo; metrics as OTLP/HTTP to Prometheus; logs as OTLP/HTTP to Loki; a summary line to the console.',
    config:
      'exporters:\n  otlp_grpc/tempo:\n    endpoint: tempo:4317\n  otlp_http/prometheus:\n    endpoint: http://prometheus:9090/api/v1/otlp\n  otlp_http/loki:\n    endpoint: http://loki:3100/otlp',
  },
  {
    id: 'backend',
    label: 'Backends',
    sub: 'Tempo · Prometheus · Loki',
    what: 'Store and query each signal: Tempo for traces (TraceQL), Prometheus for metrics (PromQL), Loki for logs (LogQL). Grafana and this site read from them.',
    why: 'Each signal has different access patterns, so each gets a store built for it.',
    data: 'Queryable telemetry, kept for 72 hours in this lab.',
  },
]

export function PipelineVisualizer() {
  const [active, setActive] = useState('processor')
  const stage = STAGES.find((s) => s.id === active) ?? STAGES[0]

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <ol className="space-y-1.5" aria-label="Telemetry pipeline stages">
        {STAGES.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => setActive(s.id)}
              aria-pressed={active === s.id}
              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left ${
                active === s.id ? 'border-accent bg-accent-soft' : 'border-line bg-paper hover:border-accent'
              }`}
            >
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full font-mono text-xs ${active === s.id ? 'bg-brand text-white' : 'bg-paper-2 text-muted'}`}
              >
                {i + 1}
              </span>
              <span>
                <span className="block font-semibold">{s.label}</span>
                <span className="block font-mono text-xs text-muted">{s.sub}</span>
              </span>
            </button>
            {i < STAGES.length - 1 && <span aria-hidden="true" className="ml-7 block h-2 w-px bg-line" />}
          </li>
        ))}
      </ol>
      <div className="card space-y-4 p-5 text-sm leading-relaxed" aria-live="polite">
        <h3 className="text-lg font-semibold">{stage.label}</h3>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">What it does</p>
          <p className="mt-1">{stage.what}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">Why it exists</p>
          <p className="mt-1">{stage.why}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">What flows through</p>
          <p className="mt-1">{stage.data}</p>
        </div>
        {stage.config && (
          <pre className="overflow-x-auto rounded-lg border border-line bg-paper-2 p-3 font-mono text-xs">
            {stage.config}
          </pre>
        )}
      </div>
    </div>
  )
}
