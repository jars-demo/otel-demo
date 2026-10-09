import type { Metadata } from 'next'

import { LiveGate } from '@/components/LiveGate'
import { TraceExplorer } from '@/components/traces/TraceExplorer'
import { PageHeader } from '@/components/ui'

export const metadata: Metadata = {
  title: 'Trace Explorer',
  description: 'Follow a request through every service: span tree, self time, critical path and the bottleneck span.',
  alternates: { canonical: '/traces/' },
}

export default function TracesPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Traces" title="Trace Explorer">
        What happened to <em>this</em> request? Every span is a step; its bar shows when it ran and how long it took.
        The solid part of a bar is the span&apos;s own time, the faded part is time spent waiting on its children.
      </PageHeader>
      <div className="mt-8">
        <LiveGate what="The Trace Explorer">
          <TraceExplorer />
        </LiveGate>
      </div>
    </div>
  )
}
