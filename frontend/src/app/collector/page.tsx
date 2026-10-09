import type { Metadata } from 'next'

import { CodeBlock } from '@/components/CodeBlock'
import { PipelineVisualizer } from '@/components/collector/PipelineVisualizer'
import { BatchingDemo, SamplingSimulator } from '@/components/collector/Simulations'
import { PageHeader, Section } from '@/components/ui'
import { readRepoFile } from '@/lib/markdown'
import { REPO_URL, VERSIONS } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Collector',
  description:
    'The OpenTelemetry Collector, opened up: receivers, processors, exporters and one pipeline per signal, with the real configuration this lab runs.',
  alternates: { canonical: '/collector/' },
}

const PIPELINES = [
  {
    signal: 'traces',
    processors: 'memory_limiter → attributes/scrub → batch',
    exporters: 'otlp_grpc/tempo, debug',
    backend: 'Tempo',
  },
  {
    signal: 'metrics',
    processors: 'memory_limiter → batch',
    exporters: 'otlp_http/prometheus, debug',
    backend: 'Prometheus (OTLP endpoint)',
  },
  {
    signal: 'logs',
    processors: 'memory_limiter → attributes/scrub → batch',
    exporters: 'otlp_http/loki, debug',
    backend: 'Loki (OTLP endpoint)',
  },
]

export default async function CollectorPage() {
  const config = await readRepoFile('infra/otel/collector.yaml')
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow={`Collector ${VERSIONS.collector}`} title="The telemetry pipeline">
        Every service sends everything to one place over OTLP. The Collector decides what happens next: it receives,
        processes and exports, with one pipeline per signal. Nothing here is hidden; this is the exact configuration the
        lab runs.
      </PageHeader>

      <Section title="Follow the data">
        <PipelineVisualizer />
      </Section>

      <Section title="Three pipelines">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pipeline</th>
                <th>Receiver</th>
                <th>Processors, in order</th>
                <th>Exporters</th>
                <th>Ends up in</th>
              </tr>
            </thead>
            <tbody>
              {PIPELINES.map((p) => (
                <tr key={p.signal}>
                  <td className="font-mono font-semibold">{p.signal}</td>
                  <td className="font-mono">otlp</td>
                  <td className="font-mono text-xs">{p.processors}</td>
                  <td className="font-mono text-xs">{p.exporters}</td>
                  <td>{p.backend}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-3xl text-sm text-muted">
          Order matters: <code className="font-mono">memory_limiter</code> goes first so overload is refused before work
          is done, <code className="font-mono">batch</code> goes last so sampling and filtering happen before batching.
          Tempo also derives service-graph and span metrics from the traces it receives and writes them to Prometheus.
        </p>
      </Section>

      <Section
        title="The configuration"
        aside={
          <a
            className="text-sm text-accent hover:underline"
            href={`${REPO_URL}/blob/main/infra/otel/collector.yaml`}
            target="_blank"
            rel="noreferrer"
          >
            infra/otel/collector.yaml on GitHub →
          </a>
        }
      >
        <CodeBlock code={config} lang="yaml" title="infra/otel/collector.yaml" numbered />
        <p className="mt-3 text-sm text-muted">
          Validate it without starting anything:{' '}
          <code className="font-mono">
            docker compose run --rm otel-collector validate --config=/etc/otelcol-contrib/config.yaml
          </code>
          . Chapters 06 and 07 walk through it and change it.
        </p>
      </Section>

      <Section title="Batching">
        <BatchingDemo />
      </Section>

      <Section title="Sampling">
        <SamplingSimulator />
        <p className="mt-3 max-w-3xl text-sm text-muted">
          The lab keeps every trace by default. Chapter 12 switches the real Collector to the{' '}
          <a
            className="text-accent hover:underline"
            href={`${REPO_URL}/blob/main/infra/otel/collector-sampling.yaml`}
            target="_blank"
            rel="noreferrer"
          >
            tail-sampling configuration
          </a>{' '}
          (keep errors, keep traces over 1 s, 10% of the rest) so you can measure the effect on live traffic instead of
          trusting this simulation.
        </p>
      </Section>
    </div>
  )
}
