import type { ReactNode } from 'react'

import { IS_STATIC_SITE } from '@/lib/site'

/**
 * Live views read real telemetry from the lab running on your machine. The public site has no
 * lab behind it, so instead of inventing numbers it shows how to start one.
 */
export function LiveGate({ what, children }: { what: string; children: ReactNode }) {
  if (!IS_STATIC_SITE) return <>{children}</>
  return <LocalOnly what={what} />
}

export function LocalOnly({ what }: { what: string }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line bg-paper-2 px-5 py-3">
        <p className="text-sm font-semibold">
          <span className="mr-2 inline-block size-2 rounded-full bg-faint align-middle" aria-hidden="true" />
          Runs on your machine
        </p>
      </div>
      <div className="space-y-4 p-5 text-sm leading-relaxed">
        <p>
          {what} reads <strong>real telemetry</strong> from the lab running on your computer: traces from Tempo, metrics
          from Prometheus and logs from Loki. This public page has no lab behind it, and it will not show invented
          numbers in their place.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-line bg-paper-2 p-3 font-mono text-[13px]">
          {`git clone https://github.com/jars-demo/otel-demo.git
cd otel-demo
docker compose up -d --build --wait`}
        </pre>
        <p>
          Then open <code className="font-mono">http://localhost:3400</code>: the same site, with every live view
          connected. New here? Start with{' '}
          <a className="text-accent underline underline-offset-4" href="/workshop/01-distributed-system/">
            Chapter 01
          </a>
          .
        </p>
      </div>
    </div>
  )
}
