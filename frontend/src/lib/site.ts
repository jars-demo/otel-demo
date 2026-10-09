// Build flavours. `npm run build` (and Docker) makes the full app: live pages call the lab.
// `npm run build:static` makes the public site: the same pages, but live pages explain how to run
// the lab locally, because the public site has no backend and never shows invented numbers.
export const IS_STATIC_SITE = process.env.NEXT_PUBLIC_SITE_MODE === 'static'

// Empty in Docker: nginx serves the site and proxies /api (gateway) and /lab (lab-console) on the
// same origin. In `npm run dev` they point at the published ports.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''
export const LAB_URL = process.env.NEXT_PUBLIC_LAB_URL ?? ''

export const SITE_URL = 'https://otel.jishanahmed.in'
export const REPO_URL = 'https://github.com/jars-demo/otel-demo'
export const GRAFANA_URL = 'http://localhost:3401'

export const SITE_NAME = 'OpenTelemetry Incident Lab'
export const TAGLINE = 'Break it. Trace it. Find it. Fix it.'

export const VERSIONS = {
  otelPython: '1.45.1',
  otelInstrumentation: '0.66b1',
  collector: '0.162.0',
  tempo: '3.1.0',
  prometheus: '3.15.0',
  loki: '3.7.8',
  grafana: '13.2.3',
  python: '3.13',
} as const

export type NavItem = { href: string; label: string }

export const NAV: NavItem[] = [
  { href: '/', label: 'Overview' },
  { href: '/workshop/', label: 'Workshop' },
  { href: '/incidents/', label: 'Incident Lab' },
  { href: '/traces/', label: 'Traces' },
  { href: '/metrics/', label: 'Metrics' },
  { href: '/logs/', label: 'Logs' },
  { href: '/collector/', label: 'Collector' },
]

export const MORE_NAV: NavItem[] = [
  { href: '/architecture/', label: 'Architecture' },
  { href: '/concepts/', label: 'Concepts' },
  { href: '/security/', label: 'Security' },
  { href: '/production/', label: 'Production' },
  { href: '/faq/', label: 'FAQ' },
]

export const JARS_LINKS = [
  { href: 'https://github.com/jars-demo', label: 'GitHub' },
  { href: 'https://github.com/jars-demo/jars-skills', label: 'JARS Skills' },
  { href: 'https://skills.jishanahmed.in', label: 'skills.jishanahmed.in' },
  { href: 'https://jishanahmed.in', label: 'Jishanahmed' },
] as const

export const SERVICES = ['api-gateway', 'order-service', 'inventory-service', 'payment-service'] as const
export type ServiceName = (typeof SERVICES)[number]
