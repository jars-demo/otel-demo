import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { IncidentRunner } from '@/components/incidents/IncidentRunner'
import { Badge } from '@/components/ui'
import { loadIncident, loadIncidents } from '@/lib/incidents'

export const dynamicParams = false

export async function generateStaticParams() {
  return (await loadIncidents()).map((incident) => ({ slug: incident.slug }))
}

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const incident = await loadIncident((await params).slug)
  if (!incident) return {}
  return {
    title: `${incident.id} · ${incident.title}`,
    description: incident.summary,
    alternates: { canonical: `/incidents/${incident.slug}/` },
  }
}

export default async function IncidentPage({ params }: Props) {
  const incident = await loadIncident((await params).slug)
  if (!incident) notFound()
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <a href="/incidents/" className="text-sm text-muted hover:text-accent">
        ← Incident Lab
      </a>
      <header className="mt-3 max-w-3xl">
        <p className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-accent">{incident.id}</span>
          <Badge tone={incident.severity === 'SEV-1' ? 'danger' : 'warn'}>{incident.severity}</Badge>
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{incident.title}</h1>
        <p className="mt-2 text-lg text-muted">{incident.summary}</p>
      </header>
      <div className="mt-10">
        <IncidentRunner incident={incident} />
      </div>
    </div>
  )
}
