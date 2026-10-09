import type { Metadata } from 'next'

import { ContentPage } from '@/components/ContentPage'

export const metadata: Metadata = {
  title: 'Security',
  description:
    'Telemetry can leak secrets and personal data. What never to collect, attribute filtering and redaction in the Collector, TLS, authentication, access control and retention.',
  alternates: { canonical: '/security/' },
}

export default function SecurityPage() {
  return (
    <ContentPage
      name="security"
      eyebrow="Security"
      title="Observability security"
      intro="Telemetry is a copy of what your system does, sent to more places and read by more people. Design what it contains."
    />
  )
}
