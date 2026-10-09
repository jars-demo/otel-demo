import type { Metadata } from 'next'

import { ContentPage } from '@/components/ContentPage'

export const metadata: Metadata = {
  title: 'Production',
  description:
    'Collector agents and gateways, scaling, batching, queues and retries, TLS and authentication, sampling, cardinality, retention and cost: what changes between this lab and production.',
  alternates: { canonical: '/production/' },
}

export default function ProductionPage() {
  return (
    <ContentPage
      name="production"
      eyebrow="Production"
      title="Production architecture"
      intro="This lab is not a production observability platform. Here is what a real one adds, and why."
    />
  )
}
