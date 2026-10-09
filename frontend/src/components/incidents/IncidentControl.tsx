'use client'

import { useState } from 'react'

import { lab, sendCheckout, usePoll, type CheckoutResult } from '@/lib/api'
import { ms } from '@/lib/format'
import type { Fault, LabStatus } from '@/lib/types'

import { Badge, Button, ErrorNote } from '../ui'

function FaultRow({
  fault,
  hidden,
  onChange,
}: {
  fault: Fault
  hidden: boolean
  onChange: (value: number | boolean) => Promise<void>
}) {
  const [draft, setDraft] = useState(String(fault.value ?? 0))
  const active = Boolean(fault.value)
  const unreachable = fault.value === null

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {fault.label}
          {!hidden && active && <Badge tone="warn">active</Badge>}
        </p>
        <p className="text-xs text-muted">
          {fault.description} <span className="font-mono text-faint">({fault.target})</span>
        </p>
      </div>
      {hidden ? (
        <span className="text-xs text-faint">hidden during the challenge</span>
      ) : unreachable ? (
        <span className="text-xs text-danger">service unreachable</span>
      ) : fault.kind === 'bool' ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            role="switch"
            checked={Boolean(fault.value)}
            onChange={(e) => void onChange(e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          {fault.value ? 'On' : 'Off'}
        </label>
      ) : (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void onChange(Math.max(0, Math.min(fault.max, Number(draft) || 0)))
          }}
        >
          <label className="sr-only" htmlFor={`fault-${fault.id}`}>
            {fault.label} ({fault.unit}, 0 to {fault.max})
          </label>
          <input
            id={`fault-${fault.id}`}
            type="number"
            min={0}
            max={fault.max}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-8 w-24 rounded-md border border-line bg-paper px-2 text-right font-mono text-sm"
          />
          <span className="w-6 text-xs text-muted">{fault.unit}</span>
          <Button type="submit" variant="secondary">
            Set
          </Button>
        </form>
      )}
    </li>
  )
}

export function IncidentControl() {
  const faults = usePoll<Fault[]>('/lab/faults', 5_000)
  const status = usePoll<LabStatus>('/lab/status', 3_000)
  const [error, setError] = useState<string | null>(null)
  const [load, setLoad] = useState({ scenario: 'mixed', rps: 5, duration_s: 120 })
  const [checkout, setCheckout] = useState<CheckoutResult | null>(null)
  const [reveal, setReveal] = useState(false)

  const incident = status.data?.incident
  const challenge = incident?.id === 'INC-999' && incident.phase !== 'resolved'
  const hidden = challenge && !reveal

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      await Promise.all([faults.refresh(), status.refresh()])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const loadStatus = status.data?.load
  const components = status.data?.components ?? {}
  const down = Object.entries(components).filter(([, state]) => state !== 'up')

  return (
    <div className="space-y-6">
      {(error || faults.error) && <ErrorNote message={error ?? faults.error ?? ''} />}
      {status.data && (
        <p className="text-sm text-muted">
          {down.length === 0 ? (
            <span className="text-ok">All {Object.keys(components).length} lab components are up.</span>
          ) : (
            <span className="text-warn">Not ready: {down.map(([name]) => name).join(', ')}.</span>
          )}{' '}
          {incident && (
            <>
              Running{' '}
              <a
                className="font-semibold text-accent hover:underline"
                href={`/incidents/${incidentSlug(incident.id)}/`}
              >
                {incident.id}
              </a>{' '}
              ({incident.phase}).
            </>
          )}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="card" aria-labelledby="faults-title">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 id="faults-title" className="font-semibold">
              Faults
            </h3>
            <div className="flex items-center gap-2">
              {challenge && (
                <button type="button" className="text-xs text-muted underline" onClick={() => setReveal(!reveal)}>
                  {reveal ? 'Hide' : 'Reveal (spoiler)'}
                </button>
              )}
              <Button variant="danger" onClick={() => void run(() => lab.post('/lab/faults/reset'))}>
                Reset all
              </Button>
            </div>
          </div>
          <ul>
            {(faults.data ?? []).map((fault) => (
              <FaultRow
                // Keyed on the value: when the lab reports a new value the row starts fresh.
                key={`${fault.id}:${String(fault.value)}`}
                fault={fault}
                hidden={hidden}
                onChange={(value) => run(() => lab.put('/lab/faults', { changes: { [fault.id]: value } }))}
              />
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            Every fault is bounded, local to the Docker network and reversible. Restarting a service clears its faults.
          </p>
        </section>

        <div className="space-y-6">
          <section className="card p-4" aria-labelledby="traffic-title">
            <h3 id="traffic-title" className="font-semibold">
              Traffic
            </h3>
            <p className="mt-1 text-xs text-muted">
              Only ever calls this lab&apos;s api-gateway. At most {loadStatus?.limits.max_rps ?? 20} requests per
              second for {Math.round((loadStatus?.limits.max_duration_s ?? 900) / 60)} minutes.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <label className="grid gap-1 font-medium text-muted">
                Scenario
                <select
                  className="h-8 rounded-md border border-line bg-paper px-1 text-sm"
                  value={load.scenario}
                  onChange={(e) => setLoad({ ...load, scenario: e.target.value })}
                >
                  <option value="mixed">Mixed</option>
                  <option value="checkout">Checkout</option>
                  <option value="browse">Browse</option>
                </select>
              </label>
              <label className="grid gap-1 font-medium text-muted">
                Req/s
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={load.rps}
                  onChange={(e) => setLoad({ ...load, rps: Number(e.target.value) })}
                  className="h-8 rounded-md border border-line bg-paper px-2 font-mono text-sm"
                />
              </label>
              <label className="grid gap-1 font-medium text-muted">
                Seconds
                <input
                  type="number"
                  min={5}
                  max={900}
                  value={load.duration_s}
                  onChange={(e) => setLoad({ ...load, duration_s: Number(e.target.value) })}
                  className="h-8 rounded-md border border-line bg-paper px-2 font-mono text-sm"
                />
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => void run(() => lab.post('/lab/load', load))}>Start traffic</Button>
              <Button
                variant="secondary"
                disabled={!loadStatus?.running}
                onClick={() => void run(() => lab.del('/lab/load'))}
              >
                Stop
              </Button>
            </div>
            {loadStatus && (loadStatus.running || loadStatus.sent > 0) && (
              <p className="mt-3 font-mono text-xs text-muted" aria-live="polite">
                {loadStatus.running ? 'Running' : 'Finished'} · {loadStatus.sent} sent ·{' '}
                {Object.entries(loadStatus.statuses)
                  .map(([code, n]) => `${code}: ${n}`)
                  .join(', ')}{' '}
                · client p95 {ms(loadStatus.client_latency_ms.p95)}
              </p>
            )}
          </section>

          <section className="card p-4" aria-labelledby="one-title">
            <h3 id="one-title" className="font-semibold">
              One checkout
            </h3>
            <p className="mt-1 text-xs text-muted">Sends a real order through the gateway and gives you its trace.</p>
            <div className="mt-3">
              <Button variant="secondary" onClick={() => void run(async () => setCheckout(await sendCheckout()))}>
                Place an order
              </Button>
            </div>
            {checkout && (
              <p className="mt-3 text-sm" aria-live="polite">
                <Badge tone={checkout.status < 400 ? 'ok' : checkout.status < 500 ? 'warn' : 'danger'}>
                  HTTP {checkout.status}
                </Badge>{' '}
                in {ms(checkout.ms)}.{' '}
                {checkout.traceId && (
                  <a className="font-mono text-accent hover:underline" href={`/traces/?id=${checkout.traceId}`}>
                    trace {checkout.traceId.slice(0, 10)}… →
                  </a>
                )}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

const SLUGS: Record<string, string> = {
  'INC-001': 'slow-checkout',
  'INC-002': 'payment-failure',
  'INC-003': 'database-latency',
  'INC-004': 'inventory-failure',
  'INC-005': 'cascading-latency',
  'INC-999': 'final-challenge',
}

function incidentSlug(id: string): string {
  return SLUGS[id] ?? ''
}
