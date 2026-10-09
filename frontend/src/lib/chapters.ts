// The workshop chapters, in order. The content lives in /workshop/*.md at the repository root (the
// single source of truth, also readable on GitHub); this list adds the titles and timings the site
// needs for navigation. Keep it in step with the files.
export type Chapter = {
  slug: string
  number: string
  title: string
  minutes: number
  summary: string
}

export const CHAPTERS: Chapter[] = [
  {
    slug: '00-observability',
    number: '00',
    title: 'What is Observability?',
    minutes: 15,
    summary: 'Signals, telemetry, and the question "why is it broken?"',
  },
  {
    slug: '01-distributed-system',
    number: '01',
    title: 'Build the Distributed System',
    minutes: 20,
    summary: 'Start the shop and the observability stack, place an order',
  },
  {
    slug: '02-instrumentation',
    number: '02',
    title: 'Instrument Your Application',
    minutes: 20,
    summary: 'SDK setup, library instrumentation and manual spans',
  },
  {
    slug: '03-traces',
    number: '03',
    title: 'Understand Traces',
    minutes: 20,
    summary: 'Spans, kinds, status, events and context propagation',
  },
  {
    slug: '04-metrics',
    number: '04',
    title: 'Add Metrics',
    minutes: 20,
    summary: 'Instruments, RED metrics, histograms and percentiles',
  },
  {
    slug: '05-logs',
    number: '05',
    title: 'Correlate Logs',
    minutes: 15,
    summary: 'Structured logs with trace_id, from trace to log and back',
  },
  {
    slug: '06-collector',
    number: '06',
    title: 'Meet the Collector',
    minutes: 15,
    summary: 'Receivers, processors, exporters and why a Collector',
  },
  {
    slug: '07-pipelines',
    number: '07',
    title: 'Build Telemetry Pipelines',
    minutes: 20,
    summary: 'Edit the pipeline, validate it, watch data flow',
  },
  {
    slug: '08-fault-injection',
    number: '08',
    title: 'Break the System',
    minutes: 15,
    summary: 'Baselines, controlled faults and Toxiproxy',
  },
  {
    slug: '09-incident-response',
    number: '09',
    title: 'Investigate an Incident',
    minutes: 25,
    summary: 'INC-001 and INC-002: from symptom to root cause',
  },
  {
    slug: '10-database-debugging',
    number: '10',
    title: 'Trace a Database Problem',
    minutes: 20,
    summary: 'INC-003: database spans, query text and DB metrics',
  },
  {
    slug: '11-cascading-failures',
    number: '11',
    title: 'Diagnose Cascading Latency',
    minutes: 20,
    summary: 'INC-004 and INC-005: self time and the critical path',
  },
  {
    slug: '12-sampling',
    number: '12',
    title: 'Sampling and Cost',
    minutes: 20,
    summary: 'Head and tail sampling, cardinality, telemetry cost',
  },
  {
    slug: '13-docker',
    number: '13',
    title: 'Docker Deployment',
    minutes: 15,
    summary: 'How the lab is built, health checks, start, stop and reset',
  },
  {
    slug: '14-production',
    number: '14',
    title: 'Production Architecture',
    minutes: 20,
    summary: 'Agents, gateways, security, SLOs and what changes in production',
  },
  {
    slug: '15-final-challenge',
    number: '15',
    title: 'Final Incident Challenge',
    minutes: 30,
    summary: 'INC-999: everything looks healthy. Find the root cause.',
  },
]

export const TOTAL_MINUTES = CHAPTERS.reduce((sum, c) => sum + c.minutes, 0)

export function chapterIndex(slug: string): number {
  return CHAPTERS.findIndex((c) => c.slug === slug)
}
