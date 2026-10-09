import type { Metadata } from 'next'

import { LiveGate } from '@/components/LiveGate'
import { MetricsDashboard } from '@/components/MetricsDashboard'
import { ServiceMapView } from '@/components/ServiceMapView'
import { PageHeader } from '@/components/ui'
import { IS_STATIC_SITE } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Metrics',
  description:
    'Service health from real metrics: request rate, errors, P50/P95/P99 latency, the service map and connection pools.',
  alternates: { canonical: '/metrics/' },
}

export default function MetricsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Metrics" title="Service Health">
        How is the system behaving over time? Rate, Errors and Duration (RED) for every service, computed by Prometheus
        from the HTTP server histograms the instrumentation records.
      </PageHeader>
      <div className="mt-8">
        <LiveGate what="The metrics dashboard">
          <MetricsDashboard />
        </LiveGate>
        {IS_STATIC_SITE && (
          <div className="mt-8">
            <p className="mb-3 text-sm text-muted">
              The topology you will see, coloured by live health once the lab runs:
            </p>
            <ServiceMapView />
          </div>
        )}
      </div>
    </div>
  )
}
