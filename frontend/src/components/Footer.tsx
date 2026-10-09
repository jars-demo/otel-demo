import { JARS_LINKS, REPO_URL, VERSIONS } from '@/lib/site'

import { Logo } from './Logo'

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line bg-paper-2">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm text-muted sm:px-6 md:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <Logo size={28} />
          <p className="max-w-xl">
            Built by{' '}
            <a
              href="https://jishanahmed.in"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-text hover:text-accent"
            >
              JARS
            </a>
            . An educational, community workshop inspired by real observability architectures. It is not the official
            OpenTelemetry Demo and is not affiliated with the OpenTelemetry project or the CNCF.
          </p>
          <p className="font-mono text-xs text-faint">
            OpenTelemetry Python {VERSIONS.otelPython} · Collector {VERSIONS.collector} · Tempo {VERSIONS.tempo} ·
            Prometheus {VERSIONS.prometheus} · Loki {VERSIONS.loki} · Grafana {VERSIONS.grafana}
          </p>
        </div>
        <ul className="flex flex-wrap content-start gap-x-5 gap-y-2 md:justify-end">
          <li>
            <a className="hover:text-text" href={REPO_URL} target="_blank" rel="noreferrer">
              Repository
            </a>
          </li>
          {JARS_LINKS.map((link) => (
            <li key={link.href}>
              <a className="hover:text-text" href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  )
}
