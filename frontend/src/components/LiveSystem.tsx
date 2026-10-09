'use client'

import { usePoll } from '@/lib/api'
import { ms, percent, rate } from '@/lib/format'
import { IS_STATIC_SITE } from '@/lib/site'
import type { ServiceMap } from '@/lib/types'

import { HealthBadge } from './ui'

export function LiveSystem() {
  const map = usePoll<ServiceMap>(IS_STATIC_SITE ? null : '/lab/servicemap?window=1m', 5_000)

  if (IS_STATIC_SITE) {
    return (
      <div className="card p-5 text-sm">
        <p className="font-semibold">Live System</p>
        <p className="mt-2 text-muted">
          When you run the lab, this panel shows each service&apos;s health, request rate, error rate and p95 latency,
          read from Prometheus every five seconds. This public page has no lab behind it, so it shows nothing rather
          than invented numbers.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-paper-2 p-3 font-mono text-xs">
          docker compose up -d --build --wait
        </pre>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <p className="font-semibold">Live System</p>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block size-2 rounded-full bg-ok-mark" aria-hidden="true" />
          live · last minute
        </p>
      </div>
      {map.error && <p className="px-5 py-4 text-sm text-danger">{map.error}</p>}
      <ul className="divide-y divide-line">
        {(map.data?.nodes ?? []).map((node) => (
          <li
            key={node.id}
            className="grid grid-cols-[1fr_auto] items-center gap-2 px-5 py-2.5 text-sm sm:grid-cols-[1.3fr_1fr_0.8fr_0.8fr_auto]"
          >
            <span className="font-medium">{node.id}</span>
            <span className="hidden font-mono text-xs text-muted sm:block">{rate(node.rps)}</span>
            <span className="hidden font-mono text-xs text-muted sm:block">err {percent(node.error_ratio)}</span>
            <span className="hidden font-mono text-xs text-muted sm:block">p95 {ms(node.p95_ms)}</span>
            <HealthBadge health={node.health} />
          </li>
        ))}
      </ul>
      <a
        href="/metrics/"
        className="block border-t border-line px-5 py-2.5 text-sm font-semibold text-accent hover:bg-paper-2"
      >
        Open the dashboard →
      </a>
    </div>
  )
}
