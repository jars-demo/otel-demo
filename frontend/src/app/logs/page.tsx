import type { Metadata } from 'next'

import { LiveGate } from '@/components/LiveGate'
import { LogExplorer } from '@/components/LogExplorer'
import { PageHeader } from '@/components/ui'

export const metadata: Metadata = {
  title: 'Logs',
  description:
    'Structured logs from every service, filterable by service, severity and trace id, each linked to its trace.',
  alternates: { canonical: '/logs/' },
}

export default function LogsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Logs" title="Log Explorer">
        What did each component report? Logs tell you what happened; the trace id on each line tells you where it
        happened in the request. Click it.
      </PageHeader>
      <div className="mt-8">
        <LiveGate what="The Log Explorer">
          <LogExplorer />
        </LiveGate>
      </div>
    </div>
  )
}
