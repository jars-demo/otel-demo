import type { Metadata } from 'next'

import { PageHeader } from '@/components/ui'

export const metadata: Metadata = {
  title: 'FAQ',
  description:
    'Common questions about the OpenTelemetry Incident Lab: requirements, the official demo, fake data, resources and troubleshooting.',
  alternates: { canonical: '/faq/' },
}

const FAQ: [string, React.ReactNode][] = [
  [
    'Is this the official OpenTelemetry Demo?',
    'No. The official OpenTelemetry Demo is a large, polyglot microservice application maintained by the OpenTelemetry project as a reference implementation. This is an independent, much smaller workshop focused on incident investigation. It is not affiliated with the OpenTelemetry project or the CNCF.',
  ],
  [
    'Is this a production observability platform?',
    'No. It is an educational lab inspired by real observability architectures. Anonymous Grafana, plain-text OTLP and demo credentials are fine on your laptop and wrong anywhere else. The Production page explains what a real deployment adds.',
  ],
  [
    'What do I need installed?',
    'Git and Docker with Compose v2. That is enough to run everything. uv (for Python) and Node.js 22 are only needed to run the tests or work on the code.',
  ],
  [
    'How much memory does it use?',
    'About 2 to 2.5 GB with traffic running. Every container has a memory limit in docker-compose.yml; the sum of the limits is about 3.3 GB, which Docker Desktop should be allowed to use.',
  ],
  [
    'Are the numbers on the public site real?',
    'The public site shows no live numbers at all: its live pages explain how to run the lab. When you run it locally, every value labelled live comes from Tempo, Prometheus or Loki. The two Collector simulations (batching and sampling) are labelled as simulations.',
  ],
  [
    'Can the fault injection hurt my machine or other systems?',
    'No. Faults are switches inside the lab’s own services plus Toxiproxy on the Docker network. Every value is bounded, nothing executes commands or touches the host, and the load generator only calls the lab’s own gateway, at most 20 requests per second for 15 minutes.',
  ],
  [
    'A trace shows a warning that spans are still arriving.',
    'Each service exports spans in batches every few seconds, so the parts of a trace reach Tempo at slightly different times. Wait five seconds and refresh.',
  ],
  [
    'Metrics say "no data".',
    'Rates need traffic. Start some from Incident Control (or run an incident) and wait about 30 seconds: services export metrics every 5 seconds and rates are computed over a window.',
  ],
  [
    'How do I reset everything?',
    <>
      <code className="font-mono">docker compose down -v</code> removes the containers and all stored telemetry and
      orders. Then <code className="font-mono">docker compose up -d --build --wait</code> starts clean. Chapter 13
      covers start, stop and reset.
    </>,
  ],
  [
    'Why Python?',
    'The OpenTelemetry Python SDK is stable for traces and metrics, has library instrumentation for FastAPI, httpx, Redis and psycopg, and is readable for most developers. The concepts carry over to every language. The Python logs SDK is still marked experimental, and the workshop says so where it matters.',
  ],
  [
    'Where are the skills mentioned in the repository?',
    <>
      The repository follows the{' '}
      <a className="text-accent hover:underline" href="https://skills.jishanahmed.in" target="_blank" rel="noreferrer">
        JARS Skills
      </a>{' '}
      playbooks for setup, tests, debugging, reviews and releases.
    </>,
  ],
]

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow="FAQ" title="Questions" />
      <div className="mt-8 divide-y divide-line rounded-xl border border-line bg-paper">
        {FAQ.map(([question, answer]) => (
          <details key={question} className="group px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
              {question}
              <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <div className="mt-2 text-sm leading-relaxed text-muted">{answer}</div>
          </details>
        ))}
      </div>
    </div>
  )
}
