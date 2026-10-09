import type { Metadata } from 'next'

import { IncidentControl } from '@/components/incidents/IncidentControl'
import { LiveGate } from '@/components/LiveGate'
import { Badge, PageHeader, Section } from '@/components/ui'
import { loadIncidents } from '@/lib/incidents'

export const metadata: Metadata = {
  title: 'Incident Lab',
  description:
    'Five incidents and a final challenge. Measure the baseline, inject the fault, investigate with traces, metrics and logs, fix it, verify recovery.',
  alternates: { canonical: '/incidents/' },
}

export default async function IncidentsPage() {
  const incidents = await loadIncidents()
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Incident Lab" title="Something is broken. How do you know why?">
        Each incident starts with a symptom, not an answer. Measure the baseline, let the lab break something, then use
        traces, metrics and logs to find the root cause. Fix it and prove the system recovered.
      </PageHeader>

      <Section title="Incidents">
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <a href={`/incidents/${incident.slug}/`} className="card flex h-full flex-col p-5 hover:border-accent">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-accent">{incident.id}</span>
                  <Badge tone={incident.severity === 'SEV-1' ? 'danger' : 'warn'}>{incident.severity}</Badge>
                  {incident.challenge && <Badge tone="accent">Final challenge</Badge>}
                </span>
                <span className="mt-2 text-lg font-semibold">{incident.title}</span>
                <span className="mt-1 flex-1 text-sm text-muted">{incident.summary}</span>
                <span className="mt-4 text-sm font-semibold text-accent">Investigate →</span>
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Incident Control" id="control">
        <p className="mb-4 max-w-3xl text-sm text-muted">
          Break things by hand: turn on a fault, send traffic, and watch the telemetry change. Running an incident above
          does the same for you, without telling you which fault it chose.
        </p>
        <LiveGate what="Incident Control">
          <IncidentControl />
        </LiveGate>
      </Section>
    </div>
  )
}
