import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import type { ReactNode } from 'react'

import { BackToTop } from '@/components/BackToTop'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { SITE_URL } from '@/lib/site'

import './globals.css'

const sans = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono', display: 'swap' })

const TITLE = 'OpenTelemetry Incident Lab · Break It. Trace It. Find It. Fix It.'
const DESCRIPTION =
  'A hands-on OpenTelemetry workshop for distributed tracing, metrics, logs, fault injection, incident investigation, and observability engineering.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: '%s · OpenTelemetry Incident Lab' },
  description: DESCRIPTION,
  applicationName: 'OpenTelemetry Incident Lab',
  keywords: [
    'OpenTelemetry',
    'observability',
    'distributed tracing',
    'OpenTelemetry Collector',
    'Tempo',
    'Prometheus',
    'Loki',
    'Grafana',
    'SRE',
    'incident response',
    'workshop',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'OpenTelemetry Incident Lab',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: [{ color: '#ffffff' }],
}

// White-first: light unless the visitor picked dark with the toggle. Runs before first paint.
const THEME_SCRIPT = `try{document.documentElement.dataset.theme=localStorage.getItem('theme')==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <BackToTop />
      </body>
    </html>
  )
}
