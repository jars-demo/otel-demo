import { LiveSystem } from '@/components/LiveSystem'
import { Badge, Section } from '@/components/ui'
import { CHAPTERS, TOTAL_MINUTES } from '@/lib/chapters'
import { loadIncidents } from '@/lib/incidents'
import { REPO_URL } from '@/lib/site'

const TECH = ['OpenTelemetry', 'Collector', 'Grafana', 'Tempo', 'Prometheus', 'Loki']

// A real INC-001 trace recorded in this lab, kept as a static example for the homepage.
const EXAMPLE = {
  duration: '3.38 s',
  rows: [
    { name: 'POST /api/checkout', service: 'api-gateway', depth: 0, start: 0, width: 100, label: '3.38 s' },
    { name: 'checkout', service: 'order-service', depth: 1, start: 0.3, width: 99.4, label: '3.37 s' },
    { name: 'order.validate', service: 'order-service', depth: 2, start: 0.4, width: 44.8, label: '1.51 s' },
    { name: 'HGETALL GET', service: 'redis', depth: 3, start: 0.6, width: 44.4, label: '1.50 s', hot: true },
    { name: 'order.reserve_inventory', service: 'order-service', depth: 2, start: 45.9, width: 44.8, label: '1.51 s' },
    { name: 'EVALSHA', service: 'redis', depth: 3, start: 46.1, width: 44.4, label: '1.50 s', hot: true },
    { name: 'order.charge_payment', service: 'order-service', depth: 2, start: 91, width: 5.6, label: '190 ms' },
  ],
}

const STEPS = [
  [
    'Break it',
    'Inject a controlled fault: Redis latency, a failing payment provider, a slow database, an exhausted connection pool.',
  ],
  ['Trace it', 'Follow requests through every service. Metrics tell you something changed; traces show where.'],
  ['Find it', 'Separate self time from waiting, follow the critical path, read the exception, correlate the logs.'],
  ['Fix it', 'Apply the fix, then prove recovery against the baseline you measured before anything broke.'],
]

export default async function HomePage() {
  const incidents = await loadIncidents()
  return (
    <>
      <section className="border-b border-line bg-gradient-to-b from-accent-soft to-bg">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:py-20">
          <div>
            <p className="font-mono text-sm font-semibold text-accent">OpenTelemetry Incident Lab</p>
            <h1 className="mt-3 text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">
              Break it.
              <br />
              Trace it.
              <br />
              Find it.
              <br />
              <span className="text-accent">Fix it.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              A hands-on observability lab where you intentionally break a distributed application and use OpenTelemetry
              traces, metrics, and logs to find the root cause.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="/workshop/"
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-hover"
              >
                Start the Lab <span aria-hidden="true">→</span>
              </a>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-paper px-5 font-semibold hover:border-accent hover:text-accent"
              >
                View on GitHub <span aria-hidden="true">→</span>
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-2" aria-label="Technologies">
              {TECH.map((tech) => (
                <li
                  key={tech}
                  className="rounded-md border border-line bg-paper px-2.5 py-1 font-mono text-xs text-muted"
                >
                  {tech}
                </li>
              ))}
            </ul>
          </div>

          <figure className="card self-center overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper-2 px-4 py-2.5">
              <span className="font-mono text-xs text-muted">INC-001 · checkout trace</span>
              <span className="flex items-center gap-2 text-xs">
                <span className="font-mono font-semibold">{EXAMPLE.duration}</span>
                <Badge tone="warn">SLO breached</Badge>
              </span>
            </div>
            <ul className="space-y-1 p-4" aria-label="Example span tree">
              {EXAMPLE.rows.map((row) => (
                <li
                  key={row.name + row.start}
                  className="grid grid-cols-[minmax(150px,42%)_1fr] items-center gap-2 text-xs"
                >
                  <span className="truncate" style={{ paddingLeft: row.depth * 12 }}>
                    <span className={row.hot ? 'font-semibold text-warn' : ''}>{row.name}</span>{' '}
                    <span className="text-faint">{row.service}</span>
                  </span>
                  <span className="relative h-4">
                    <span
                      className={`absolute top-1 h-2 rounded-sm ${row.hot ? 'bg-warn-mark' : 'bg-brand/70'}`}
                      style={{ left: `${row.start}%`, width: `${row.width}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
            <figcaption className="grid grid-cols-2 gap-3 border-t border-line px-4 py-3 text-xs">
              <span>
                <span className="block text-muted">Slowest spans</span>
                <span className="font-mono font-semibold">Redis, 1.50 s each</span>
              </span>
              <span>
                <span className="block text-muted">Root cause</span>
                <span className="font-semibold">Latency between inventory and Redis</span>
              </span>
              <span className="col-span-2 text-faint">
                A real trace recorded in this lab, shown as a static example.
              </span>
            </figcaption>
          </figure>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Section title="How the lab works">
          <ol className="grid gap-4 md:grid-cols-4">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="card p-5">
                <span className="font-mono text-xs text-accent">0{i + 1}</span>
                <p className="mt-1 text-lg font-semibold">{title}</p>
                <p className="mt-1 text-sm text-muted">{text}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Live System">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <LiveSystem />
            <div className="space-y-3 text-sm leading-relaxed text-muted">
              <p>
                <strong className="text-text">A small system you can hold in your head.</strong> Four FastAPI services,
                PostgreSQL and Redis. A checkout crosses all of them, so one click produces a trace of about 25 spans.
              </p>
              <p>
                <strong className="text-text">A real telemetry pipeline.</strong> Every service sends traces, metrics
                and logs over OTLP to an OpenTelemetry Collector, which routes them to Tempo, Prometheus and Loki.
                Grafana and this site read from them.
              </p>
              <p>
                <strong className="text-text">Nothing faked.</strong> Faults are real: latency is added on the network
                path, errors are raised in code. Every live number comes from the backends.
              </p>
              <a href="/architecture/" className="inline-block font-semibold text-accent hover:underline">
                See the architecture →
              </a>
            </div>
          </div>
        </Section>

        <Section title="Three signals, three questions">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ['Trace', 'What happened to this request?', '/traces/'],
              ['Metric', 'How is the system behaving over time?', '/metrics/'],
              ['Log', 'What did this component report?', '/logs/'],
            ].map(([signal, question, href]) => (
              <a key={signal} href={href} className="card p-5 hover:border-accent">
                <p className="font-mono text-xs font-semibold uppercase tracking-wide text-accent">{signal}</p>
                <p className="mt-1 text-lg font-semibold">{question}</p>
              </a>
            ))}
          </div>
        </Section>

        <Section
          title="Incidents"
          aside={
            <a href="/incidents/" className="text-sm font-semibold text-accent hover:underline">
              Open the Incident Lab →
            </a>
          }
        >
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {incidents.map((incident) => (
              <li key={incident.id}>
                <a
                  href={`/incidents/${incident.slug}/`}
                  className="card flex items-start gap-3 p-4 hover:border-accent"
                >
                  <span className="font-mono text-sm font-semibold text-accent">{incident.id}</span>
                  <span>
                    <span className="block font-semibold">{incident.title}</span>
                    <span className="block text-sm text-muted">{incident.summary}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="The workshop">
          <div className="card grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-lg font-semibold">
                {CHAPTERS.length} chapters, about {Math.round(TOTAL_MINUTES / 60)} hours, from &quot;what is
                observability?&quot; to a final incident challenge.
              </p>
              <p className="mt-1 text-sm text-muted">
                Every command says what it does, why, and what you should see. Every chapter ends with a challenge.
              </p>
            </div>
            <a
              href="/workshop/"
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-hover"
            >
              Start with chapter 00 <span aria-hidden="true">→</span>
            </a>
          </div>
          <p className="mt-6 text-xs text-faint">
            An educational project inspired by real observability architectures. It is not a production observability
            platform and it is not the official OpenTelemetry Demo.
          </p>
        </Section>
      </div>
    </>
  )
}
