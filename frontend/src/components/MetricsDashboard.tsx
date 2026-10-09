'use client'

import { useState } from 'react'

import { usePoll } from '@/lib/api'
import { ms, percent, rate } from '@/lib/format'
import { GRAFANA_URL } from '@/lib/site'
import type { PoolMetrics, ServiceMap, TimeSeries } from '@/lib/types'

import { LineChart } from './LineChart'
import { ServiceMapView } from './ServiceMapView'
import { ErrorNote, HealthBadge, Section, Stat } from './ui'

const field = 'h-9 rounded-lg border border-line bg-paper px-2 text-sm'

export function MetricsDashboard() {
  const [window, setWindow] = useState('1m')
  const [minutes, setMinutes] = useState('15')
  const [selected, setSelected] = useState<string | null>(null)

  const map = usePoll<ServiceMap>(`/lab/servicemap?window=${window}`, 5_000)
  const series = usePoll<TimeSeries>(`/lab/metrics/timeseries?minutes=${minutes}`, 15_000)
  const pools = usePoll<PoolMetrics>('/lab/metrics/pools', 5_000)

  const gateway = map.data?.nodes.find((n) => n.id === 'api-gateway')
  const selectedNode = map.data?.nodes.find((n) => n.id === selected)
  const dependencies = map.data?.edges.filter((e) => e.source === selected || e.target === selected) ?? []

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-medium text-muted">
          Rate window
          <select className={field} value={window} onChange={(e) => setWindow(e.target.value)}>
            <option value="30s">30 s</option>
            <option value="1m">1 min</option>
            <option value="5m">5 min</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted">
          Chart range
          <select className={field} value={minutes} onChange={(e) => setMinutes(e.target.value)}>
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="60">1 hour</option>
          </select>
        </label>
        <p className="ml-auto flex items-center gap-2 text-xs text-muted">
          <span className="inline-block size-2 rounded-full bg-ok-mark" aria-hidden="true" />
          Live from Prometheus, refreshed every 5 s ·{' '}
          <a className="text-accent hover:underline" href={GRAFANA_URL} target="_blank" rel="noreferrer">
            Open Grafana
          </a>
        </p>
      </div>

      {map.error && <ErrorNote message={map.error} />}

      <div className="grid grid-cols-2 gap-3 pt-4 md:grid-cols-4">
        <Stat label="Request rate" value={rate(gateway?.rps)} hint={`api-gateway, ${window} window`} />
        <Stat
          label="Error rate"
          value={percent(gateway?.error_ratio)}
          hint="HTTP 5xx share"
          tone={
            (gateway?.error_ratio ?? 0) >= 0.1 ? 'danger' : (gateway?.error_ratio ?? 0) >= 0.01 ? 'warn' : undefined
          }
        />
        <Stat
          label="P95 latency"
          value={ms(gateway?.p95_ms)}
          hint="95% of requests faster"
          tone={(gateway?.p95_ms ?? 0) >= 2000 ? 'danger' : (gateway?.p95_ms ?? 0) >= 500 ? 'warn' : undefined}
        />
        <Stat label="P99 latency" value={ms(gateway?.p99_ms)} hint="the slowest 1% start here" />
      </div>

      <Section title="Service map">
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <ServiceMapView data={map.data} selected={selected} onSelect={setSelected} />
          <aside className="card p-4 text-sm" aria-live="polite">
            {selectedNode ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{selectedNode.id}</h3>
                  <HealthBadge health={selectedNode.health} />
                </div>
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-muted">Rate</dt>
                    <dd className="font-mono font-semibold">{rate(selectedNode.rps)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Errors</dt>
                    <dd className="font-mono font-semibold">{percent(selectedNode.error_ratio)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">P95</dt>
                    <dd className="font-mono font-semibold">{ms(selectedNode.p95_ms)}</dd>
                  </div>
                </dl>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Dependencies</p>
                  <ul className="mt-1 space-y-1 font-mono text-xs">
                    {dependencies.length === 0 && <li className="text-faint">no traffic in this window</li>}
                    {dependencies.map((e) => (
                      <li key={`${e.source}-${e.target}`}>
                        {e.source} → {e.target}{' '}
                        <span className="text-faint">
                          {rate(e.rps)} · p95 {ms(e.p95_ms)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                {selectedNode.type === 'service' ? (
                  <ul className="space-y-1.5">
                    <li>
                      <a className="text-accent hover:underline" href={`/traces/?service=${selectedNode.id}`}>
                        Traces through {selectedNode.id} →
                      </a>
                    </li>
                    <li>
                      <a
                        className="text-accent hover:underline"
                        href={`/traces/?service=${selectedNode.id}&errors=true`}
                      >
                        Error traces →
                      </a>
                    </li>
                    <li>
                      <a className="text-accent hover:underline" href={`/logs/?service=${selectedNode.id}`}>
                        Logs from {selectedNode.id} →
                      </a>
                    </li>
                  </ul>
                ) : (
                  <p className="text-xs text-muted">
                    A data store has no telemetry of its own here: its health is what its callers measured (the CLIENT
                    spans).
                  </p>
                )}
              </div>
            ) : (
              <p className="text-muted">
                Select a service on the map to see its numbers, dependencies, traces and logs.
              </p>
            )}
          </aside>
        </div>
      </Section>

      <Section title="Services">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Rate</th>
                <th>Errors</th>
                <th>P50</th>
                <th>P95</th>
                <th>P99</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(map.data?.nodes ?? [])
                .filter((n) => n.type === 'service')
                .map((n) => {
                  return (
                    <tr key={n.id}>
                      <td className="font-medium">{n.id}</td>
                      <td className="font-mono tabular-nums">{rate(n.rps)}</td>
                      <td className="font-mono tabular-nums">{percent(n.error_ratio)}</td>
                      <td className="font-mono tabular-nums">{ms(n.p50_ms)}</td>
                      <td className="font-mono tabular-nums">{ms(n.p95_ms)}</td>
                      <td className="font-mono tabular-nums">{ms(n.p99_ms)}</td>
                      <td>
                        <HealthBadge health={n.health} />
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Degraded: p95 ≥ 500 ms or errors ≥ 1%. Unhealthy: p95 ≥ 2 s or errors ≥ 10%. Fixed lab thresholds; production
          would use SLOs.
        </p>
      </Section>

      <Section title="Over time">
        {series.error && <ErrorNote message={series.error} />}
        <div className={`grid gap-4 lg:grid-cols-3 ${series.loading ? 'opacity-80' : ''}`}>
          <LineChart
            title="Requests"
            unitLabel="requests per second"
            series={series.data?.series.rps ?? {}}
            format={(v) => rate(v)}
          />
          <LineChart
            title="Errors"
            unitLabel="HTTP 5xx per second"
            emptyText="No 5xx responses in this window. That is good news."
            series={series.data?.series.errors ?? {}}
            format={(v) => rate(v)}
          />
          <LineChart
            title="P95 latency"
            unitLabel="milliseconds"
            series={series.data?.series.p95_ms ?? {}}
            format={(v) => ms(v)}
          />
        </div>
      </Section>

      <Section title="Database connection pools">
        {pools.error && <ErrorNote message={pools.error} />}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Used</th>
                <th>Idle</th>
                <th>Max</th>
                <th>Waiting</th>
                <th>Wait p95</th>
                <th>Timeouts</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(pools.data ?? {}).map(([service, p]) => (
                <tr key={service}>
                  <td className="font-medium">{service}</td>
                  <td className="font-mono">{p.used ?? '-'}</td>
                  <td className="font-mono">{p.idle ?? '-'}</td>
                  <td className="font-mono">{p.max ?? '-'}</td>
                  <td className={`font-mono ${(p.pending ?? 0) > 0 ? 'font-semibold text-warn' : ''}`}>
                    {p.pending ?? '-'}
                  </td>
                  <td className="font-mono">{ms(p.wait_p95_ms ?? null)}</td>
                  <td className="font-mono">{rate(p.timeouts_per_s ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          The <code className="font-mono">db.client.connection.*</code> semantic-convention metrics: time spent waiting
          for a connection happens before any SQL runs, so no query span shows it.
        </p>
      </Section>
    </div>
  )
}
