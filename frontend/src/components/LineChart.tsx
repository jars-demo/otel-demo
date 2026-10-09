'use client'

import { useId, useMemo, useState } from 'react'

import { clock } from '@/lib/format'
import type { Point } from '@/lib/types'

// Colour follows the service, never its rank: the same service is always the same slot.
export const SERIES_COLOR: Record<string, string> = {
  'api-gateway': 'var(--series-1)',
  'order-service': 'var(--series-2)',
  'inventory-service': 'var(--series-3)',
  'payment-service': 'var(--series-4)',
}

const WIDTH = 560
const HEIGHT = 200
const PAD = { top: 12, right: 92, bottom: 24, left: 48 }

function niceMax(value: number): number {
  if (value <= 0) return 1
  const exp = 10 ** Math.floor(Math.log10(value))
  const n = value / exp
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * exp
}

export function LineChart({
  title,
  series,
  format,
  unitLabel,
}: {
  title: string
  series: Record<string, Point[]>
  format: (value: number | null) => string
  unitLabel: string
}) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const names = Object.keys(SERIES_COLOR).filter((name) => series[name]?.length)

  const { times, yMax } = useMemo(() => {
    const allTimes = new Set<number>()
    let max = 0
    for (const name of names) {
      for (const [t, v] of series[name]) {
        allTimes.add(t)
        if (v !== null && v > max) max = v
      }
    }
    return { times: [...allTimes].sort((a, b) => a - b), yMax: niceMax(max) }
  }, [names, series])

  if (!names.length || times.length < 2) {
    return (
      <div className="card p-4">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-6 pb-6 text-center text-sm text-muted">No data in this window yet. Send some traffic.</p>
      </div>
    )
  }

  const t0 = times[0]
  const t1 = times[times.length - 1]
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * (WIDTH - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (1 - v / yMax) * (HEIGHT - PAD.top - PAD.bottom)
  const values = (name: string) => new Map(series[name].map(([t, v]) => [t, v]))
  const lookup = Object.fromEntries(names.map((name) => [name, values(name)]))

  function path(name: string) {
    let d = ''
    let pen = false
    for (const [t, v] of series[name]) {
      if (v === null) {
        pen = false
        continue
      }
      d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)} ${y(v).toFixed(1)}`
      pen = true
    }
    return d
  }

  function onMove(event: React.PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - box.left) / box.width) * (WIDTH - PAD.left - PAD.right) + PAD.left
    let best = 0
    for (let i = 1; i < times.length; i++) if (Math.abs(x(times[i]) - px) < Math.abs(x(times[best]) - px)) best = i
    setHover(best)
  }

  const lastValues = names.map((name) => {
    const points = series[name].filter(([, v]) => v !== null)
    const last = points[points.length - 1]
    return { name, y: last ? y(last[1] as number) : null, value: last?.[1] ?? null }
  })
  // Nudge end labels apart so they do not overlap.
  const sortedLabels = [...lastValues].filter((l) => l.y !== null).sort((a, b) => (a.y as number) - (b.y as number))
  for (let i = 1; i < sortedLabels.length; i++) {
    const prev = sortedLabels[i - 1].y as number
    if ((sortedLabels[i].y as number) - prev < 12) sortedLabels[i].y = prev + 12
  }

  const hoverTime = hover !== null ? times[hover] : null

  return (
    <figure className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <figcaption>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted">{unitLabel}</p>
        </figcaption>
        <button
          type="button"
          onClick={() => setTable(!table)}
          className="rounded-md border border-line px-2 py-0.5 text-xs text-muted hover:text-text"
          aria-pressed={table}
        >
          {table ? 'Chart' : 'Table'}
        </button>
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
        {names.map((name) => (
          <li key={name} className="inline-flex items-center gap-1.5">
            <svg width="14" height="4" aria-hidden="true">
              <line x1="0" y1="2" x2="14" y2="2" stroke={SERIES_COLOR[name]} strokeWidth="2" strokeLinecap="round" />
            </svg>
            {name}
          </li>
        ))}
      </ul>

      {table ? (
        <div className="table-wrap mt-3 max-h-64 overflow-y-auto">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                {names.map((name) => (
                  <th key={name}>{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...times].reverse().map((t) => (
                <tr key={t}>
                  <td className="font-mono">{clock(t * 1000)}</td>
                  {names.map((name) => (
                    <td key={name} className="font-mono tabular-nums">
                      {format(lookup[name].get(t) ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-2">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-labelledby={`${id}-t`}>
            <title id={`${id}-t`}>{`${title}, ${unitLabel}, per service`}</title>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1={PAD.left}
                  x2={WIDTH - PAD.right}
                  y1={y(yMax * f)}
                  y2={y(yMax * f)}
                  stroke="var(--line)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 6}
                  y={y(yMax * f) + 3}
                  textAnchor="end"
                  className="fill-[var(--faint)] font-mono text-[10px]"
                >
                  {format(yMax * f)}
                </text>
              </g>
            ))}
            <text x={PAD.left} y={HEIGHT - 6} className="fill-[var(--faint)] font-mono text-[10px]">
              {clock(t0 * 1000)}
            </text>
            <text
              x={WIDTH - PAD.right}
              y={HEIGHT - 6}
              textAnchor="end"
              className="fill-[var(--faint)] font-mono text-[10px]"
            >
              {clock(t1 * 1000)}
            </text>
            {names.map((name) => (
              <path
                key={name}
                d={path(name)}
                fill="none"
                stroke={SERIES_COLOR[name]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {sortedLabels.map((label) => (
              <text
                key={label.name}
                x={WIDTH - PAD.right + 6}
                y={(label.y as number) + 3}
                className="fill-[var(--muted)] text-[10px]"
              >
                {label.name.replace('-service', '')}
              </text>
            ))}
            {hoverTime !== null && (
              <g pointerEvents="none">
                <line
                  x1={x(hoverTime)}
                  x2={x(hoverTime)}
                  y1={PAD.top}
                  y2={HEIGHT - PAD.bottom}
                  stroke="var(--muted)"
                  strokeWidth={1}
                />
                {names.map((name) => {
                  const v = lookup[name].get(hoverTime)
                  return v === null || v === undefined ? null : (
                    <circle
                      key={name}
                      cx={x(hoverTime)}
                      cy={y(v)}
                      r={4}
                      fill={SERIES_COLOR[name]}
                      stroke="var(--paper)"
                      strokeWidth={2}
                    />
                  )
                })}
              </g>
            )}
            <rect
              x={PAD.left}
              y={PAD.top}
              width={WIDTH - PAD.left - PAD.right}
              height={HEIGHT - PAD.top - PAD.bottom}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
          {hoverTime !== null && (
            <div
              className="card pointer-events-none absolute top-2 z-10 min-w-40 px-3 py-2 text-xs"
              style={{ left: `${Math.min(70, (x(hoverTime) / WIDTH) * 100)}%` }}
            >
              <p className="font-mono text-faint">{clock(hoverTime * 1000)}</p>
              {names.map((name) => (
                <p key={name} className="mt-1 flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-muted">
                    <svg width="10" height="4" aria-hidden="true">
                      <line x1="0" y1="2" x2="10" y2="2" stroke={SERIES_COLOR[name]} strokeWidth="2" />
                    </svg>
                    {name}
                  </span>
                  <span className="font-mono font-semibold tabular-nums">
                    {format(lookup[name].get(hoverTime) ?? null)}
                  </span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  )
}
