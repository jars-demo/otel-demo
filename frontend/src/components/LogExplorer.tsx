'use client'

import { useEffect, useState } from 'react'

import { usePoll } from '@/lib/api'
import { useIsClient } from '@/lib/hooks'
import { shortId } from '@/lib/format'
import { SERVICES } from '@/lib/site'
import type { LogEntry } from '@/lib/types'

import { Empty, ErrorNote } from './ui'

type Filters = { service: string; severity: string; trace_id: string; search: string; minutes: string }
const KEYS: (keyof Filters)[] = ['service', 'severity', 'trace_id', 'search', 'minutes']

const SEVERITY_CLASS: Record<string, string> = {
  ERROR: 'bg-danger-soft text-danger',
  FATAL: 'bg-danger-soft text-danger',
  WARNING: 'bg-warn-soft text-warn',
  WARN: 'bg-warn-soft text-warn',
  INFO: 'bg-paper-2 text-muted',
  DEBUG: 'bg-paper-2 text-faint',
}

function time(ns: number): string {
  const date = new Date(ns / 1e6)
  return `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

const field = 'h-9 rounded-lg border border-line bg-paper px-2 text-sm'

function filtersFromUrl(): Filters {
  const params = new URLSearchParams(window.location.search)
  const filters: Filters = { service: '', severity: '', trace_id: '', search: '', minutes: '15' }
  for (const key of KEYS) filters[key] = params.get(key) ?? filters[key]
  return filters
}

/** Filters start from the URL (links from traces carry trace_id), so render in the browser only. */
export function LogExplorer() {
  return useIsClient() ? <Explorer initial={filtersFromUrl()} /> : null
}

function Explorer({ initial }: { initial: Filters }) {
  const [filters, setFilters] = useState<Filters>(initial)

  useEffect(() => {
    const params = new URLSearchParams()
    for (const key of KEYS)
      if (filters[key] && !(key === 'minutes' && filters.minutes === '15')) params.set(key, filters[key])
    const query = params.toString()
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
  }, [filters])

  const query = new URLSearchParams({ minutes: filters.minutes, limit: '200' })
  for (const key of ['service', 'severity', 'trace_id', 'search'] as const)
    if (filters[key]) query.set(key, filters[key].trim())
  const logs = usePoll<LogEntry[]>(`/lab/logs?${query}`, 10_000)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-medium text-muted">
          Service
          <select
            className={field}
            value={filters.service}
            onChange={(e) => setFilters({ ...filters, service: e.target.value })}
          >
            <option value="">All</option>
            {SERVICES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted">
          Severity
          <select
            className={field}
            value={filters.severity}
            onChange={(e) => setFilters({ ...filters, severity: e.target.value })}
          >
            <option value="">All</option>
            <option value="ERROR">ERROR</option>
            <option value="WARNING">WARNING</option>
            <option value="INFO">INFO</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted">
          Trace ID
          <input
            className={`${field} w-72 font-mono`}
            value={filters.trace_id}
            onChange={(e) => setFilters({ ...filters, trace_id: e.target.value })}
            placeholder="any"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted">
          Message contains
          <input
            className={field}
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="timeout"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted">
          Last
          <select
            className={field}
            value={filters.minutes}
            onChange={(e) => setFilters({ ...filters, minutes: e.target.value })}
          >
            <option value="5">5 min</option>
            <option value="15">15 min</option>
            <option value="60">1 hour</option>
          </select>
        </label>
        {(filters.service || filters.severity || filters.trace_id || filters.search) && (
          <button
            type="button"
            className="h-9 text-sm text-accent hover:underline"
            onClick={() =>
              setFilters({ service: '', severity: '', trace_id: '', search: '', minutes: filters.minutes })
            }
          >
            Clear filters
          </button>
        )}
      </div>

      {logs.error && <ErrorNote message={logs.error} />}
      {logs.data && logs.data.length === 0 && <Empty>No log records match these filters.</Empty>}
      {logs.data && logs.data.length > 0 && (
        <div className={`table-wrap ${logs.loading ? 'opacity-70' : ''}`}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Severity</th>
                <th>Service</th>
                <th>Message</th>
                <th>Trace</th>
              </tr>
            </thead>
            <tbody>
              {logs.data.map((entry, i) => (
                <tr key={`${entry.timestamp_ns}-${i}`}>
                  <td className="whitespace-nowrap font-mono text-xs">{time(entry.timestamp_ns)}</td>
                  <td>
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${SEVERITY_CLASS[entry.severity] ?? SEVERITY_CLASS.INFO}`}
                    >
                      {entry.severity}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-xs">{entry.service}</td>
                  <td>
                    <p>{entry.message}</p>
                    {Object.keys(entry.attributes).length > 0 && (
                      <p className="mt-0.5 font-mono text-[11px] text-faint">
                        {Object.entries(entry.attributes)
                          .map(([k, v]) => `${k}=${v}`)
                          .join('  ')}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    {entry.trace_id ? (
                      <a
                        className="font-mono text-xs text-accent hover:underline"
                        href={`/traces/?id=${entry.trace_id}`}
                        title="Open this trace"
                      >
                        {shortId(entry.trace_id, 10)}… →
                      </a>
                    ) : (
                      <span className="text-xs text-faint">none</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        Logs reach Loki over OTLP. trace_id and span_id are stored as structured metadata, and attribute names appear as
        Loki stores them, with dots replaced by underscores.
      </p>
    </div>
  )
}
