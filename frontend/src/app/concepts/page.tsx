import type { Metadata } from 'next'

import { ContentPage } from '@/components/ContentPage'

export const metadata: Metadata = {
  title: 'Concepts',
  description:
    'Traces, metrics and logs; spans and context propagation; semantic conventions and resources; RED, golden signals, SLOs, cardinality and the cost of telemetry.',
  alternates: { canonical: '/concepts/' },
}

export default function ConceptsPage() {
  return (
    <ContentPage
      name="concepts"
      eyebrow="Concepts"
      title="The ideas behind the lab"
      intro="Everything the workshop relies on, in one place: what each signal is for, how a trace is built, why names matter, and why observability has to be engineered like any other system."
    />
  )
}
