'use client'

import { useEffect, useMemo, useState } from 'react'

import { sendCheckout, usePoll } from '@/lib/api'
import { useIsClient } from '@/lib/hooks'
import { clock, ms, shortId } from '@/lib/format'
import { GRAFANA_URL, SERVICES } from '@/lib/site'
import type { Trace, TraceSummary } from '@/lib/types'

import { Badge, Button, Empty, ErrorNote } from '../ui'
import { SpanDetails, Waterfall } from './Waterfall'

type Filters = { operation: string; service: string; errors: boolean; slower: string; minutes: string }

function readUrl(): { id: string | null; filters: Filters } {
  const params = new URLSearchParams(window.location.search)
  return {
    id: params.get('id'),
    filters: {
      operation: params.get('operation') ?? '',
      service: params.get('service') ?? '',
      errors: params.get('errors') === 'true',
      slower: params.get('slower') ?? '',
      minutes: params.get('minutes') ?? '15',
    },
  }
}

function writeUrl(id: string | null, filters: Filters) {
  const params = new URLSearchParams()
  if (id) params.set('id', id)
  if (filters.operation) params.set('operation', filters.operation)
  if (filters.service) params.set('service', filters.service)
  if (filters.errors) params.set('errors', 'true')
  if (filters.slower) params.set('slower', filters.slower)
  if (filters.minutes !== '15') params.set('minutes', filters.minutes)
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
}

function searchPath(f: Filters): string {
  const params = new URLSearchParams({ minutes: f.minutes, limit: '30' })
  if (f.operation) params.set('operation', f.operation)
  if (f.service) params.set('service', f.service)
  if (f.errors) params.set('errors_only', 'true')
  if (f.slower) params.set('min_duration_ms', f.slower)
  return `/lab/traces?${params}`
}

const select = 'h-9 rounded-lg border border-line bg-paper px-2 text-sm'

/** The explorer reads its starting state from the URL, so it only renders in the browser. */
export function TraceExplorer() {
  return useIsClient() ? <Explorer initial={readUrl()} /> : null
}

function Explorer({ initial }: { initial: { id: string | null; filters: Filters } }) {
  const [filters, setFilters] = useState<Filters>(initial.filters)
  const [traceId, setTraceId] = useState<string | null>(initial.id)
  const [spanId, setSpanId] = useState<string | null>(null)
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [lookup, setLookup] = useState('')

  // Keep the URL shareable: it always reflects the open trace and the filters.
  useEffect(() => writeUrl(traceId, filters), [traceId, filters])

  const list = usePoll<TraceSummary[]>(searchPath(filters), 10_000)
  const detail = usePoll<Trace>(traceId ? `/lab/traces/${traceId}` : null, 0)
  const trace = detail.data && detail.data.trace_id === traceId?.padStart(32, '0') ? detail.data : null
  const span = useMemo(
    () => trace?.spans.find((s) => s.span_id === (spanId ?? trace.bottleneck_span_id)) ?? null,
    [trace, spanId],
  )

  function open(id: string) {
    setTraceId(id)
    setSpanId(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function newCheckout() {
    const result = await sendCheckout()
    if (result.traceId) {
      // Spans arrive in batches (each service exports every few seconds): give them a moment.
      window.setTimeout(() => open(result.traceId as string), 6000)
    }
  }

  return (
    <div className="space-y-6">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (lookup.trim()) open(lookup.trim().toLowerCase())
        }}
      >
        <label className="grid gap-1 text-xs font-medium text-muted">
          Operation
          <select
            className={select}
            value={filters.operation}
            onChange={(e) => setFilters({ ...filters, operation: e.target.value })}
          >
            <option value="">All</option>
            <option value="checkout">Checkout</option>
            <option value="products">Products</option>
            <option value="orders">Orders</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted">
          Touches service
          <select
            className={select}
            value={filters.service}
            onChange={(e) => setFilters({ ...filters, service: e.target.value })}
          >
            <option value="">Any</option>
            {SERVICES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted">
          Slower than
          <select
            className={select}
            value={filters.slower}
            onChange={(e) => setFilters({ ...filters, slower: e.target.value })}
          >
            <option value="">Any</option>
            {['300', '1000', '1500', '2000', '3000'].map((v) => (
              <option key={v} value={v}>
                {ms(Number(v))}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted">
          Last
          <select
            className={select}
            value={filters.minutes}
            onChange={(e) => setFilters({ ...filters, minutes: e.target.value })}
          >
            <option value="5">5 min</option>
            <option value="15">15 min</option>
            <option value="60">1 hour</option>
          </select>
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.errors}
            onChange={(e) => setFilters({ ...filters, errors: e.target.checked })}
            className="size-4 accent-[var(--accent)]"
          />
          Errors only
        </label>
        <span className="ml-auto flex items-end gap-2">
          <label className="grid gap-1 text-xs font-medium text-muted">
            Trace ID
            <input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="32 hex characters"
              className="h-9 w-64 rounded-lg border border-line bg-paper px-2 font-mono text-sm"
              pattern="[0-9a-fA-F]{1,32}"
            />
          </label>
          <Button type="submit" variant="secondary">
            Open
          </Button>
        </span>
      </form>

      {traceId && (
        <section aria-label="Trace detail" className="space-y-4">
          {detail.error && <ErrorNote message={detail.error} />}
          {trace && (
            <>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div>
                  <p className="font-mono text-xs text-faint">trace_id {trace.trace_id}</p>
                  <h2 className="text-lg font-semibold">{trace.root_name}</h2>
                </div>
                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <div>
                    <dt className="text-xs text-muted">Duration</dt>
                    <dd className="font-mono font-semibold">{ms(trace.duration_ms)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Status</dt>
                    <dd>
                      <Badge tone={trace.status === 'error' ? 'danger' : 'ok'}>
                        {trace.status === 'error' ? 'ERROR' : 'OK'} {trace.http_status_code ?? ''}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Spans</dt>
                    <dd className="font-mono font-semibold">{trace.span_count}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Services</dt>
                    <dd className="text-xs">{trace.services.join(', ')}</dd>
                  </div>
                </dl>
                <div className="ml-auto flex gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={criticalOnly}
                      onChange={(e) => setCriticalOnly(e.target.checked)}
                      className="size-4 accent-[var(--accent)]"
                    />
                    Critical path only
                  </label>
                  <Button variant="secondary" onClick={() => void detail.refresh()}>
                    Refresh
                  </Button>
                </div>
              </div>
              {trace.incomplete && (
                <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                  Some spans have not arrived yet: services export in batches every few seconds. Refresh in a moment.
                </p>
              )}
              <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
                <Waterfall
                  trace={trace}
                  selected={span?.span_id ?? null}
                  onSelect={setSpanId}
                  criticalOnly={criticalOnly}
                />
                {span && <SpanDetails span={span} traceId={trace.trace_id} />}
              </div>
              <p className="text-xs text-muted">
                Also in Grafana:{' '}
                <a
                  className="text-accent underline-offset-4 hover:underline"
                  href={`${GRAFANA_URL}/explore`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Explore → Tempo
                </a>{' '}
                and paste the trace id.
              </p>
            </>
          )}
        </section>
      )}

      <section aria-label="Recent traces">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Recent traces</h2>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void newCheckout()}>
              Send a checkout
            </Button>
            <Button variant="secondary" onClick={() => void list.refresh()}>
              Refresh
            </Button>
          </div>
        </div>
        {list.error && <ErrorNote message={list.error} />}
        {list.data && list.data.length === 0 && <Empty>No traces match. Send a checkout, or widen the filters.</Empty>}
        {list.data && list.data.length > 0 && (
          <div className={`table-wrap ${list.loading ? 'opacity-70' : ''}`}>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Root</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Trace ID</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((t) => (
                  <tr key={t.trace_id} className={t.trace_id === traceId ? 'bg-accent-soft' : ''}>
                    <td className="font-mono">{clock(t.start_unix_ms)}</td>
                    <td>{t.root_name}</td>
                    <td className="font-mono tabular-nums">{ms(t.duration_ms)}</td>
                    <td>
                      <Badge tone={t.status === 'error' ? 'danger' : 'ok'}>
                        {t.status === 'error' ? 'ERROR' : 'OK'} {t.http_status_code ?? ''}
                      </Badge>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="font-mono text-accent hover:underline"
                        onClick={() => open(t.trace_id)}
                      >
                        {shortId(t.trace_id, 12)}…
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
