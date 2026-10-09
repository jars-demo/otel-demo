'use client'

import { ms } from '@/lib/format'
import type { Span, Trace } from '@/lib/types'

const KIND_LABEL: Record<Span['kind'], string> = {
  server: 'SERVER',
  client: 'CLIENT',
  internal: 'INTERNAL',
  producer: 'PRODUCER',
  consumer: 'CONSUMER',
}

export function Waterfall({
  trace,
  selected,
  onSelect,
  criticalOnly,
}: {
  trace: Trace
  selected: string | null
  onSelect: (spanId: string) => void
  criticalOnly: boolean
}) {
  const total = trace.duration_ms || 1
  const spans = criticalOnly ? trace.spans.filter((s) => s.critical) : trace.spans

  return (
    <div className="card overflow-x-auto">
      <div className="grid min-w-[720px] grid-cols-[minmax(260px,38%)_1fr] border-b border-line bg-paper-2 px-3 py-2 text-xs font-medium text-muted">
        <span>Span</span>
        <div className="flex justify-between font-mono">
          <span>0 ms</span>
          <span>{ms(total / 2)}</span>
          <span>{ms(total)}</span>
        </div>
      </div>
      <ul className="min-w-[720px]" role="tree" aria-label="Span tree">
        {spans.map((span) => {
          const left = (span.offset_ms / total) * 100
          const width = Math.max((span.duration_ms / total) * 100, 0.4)
          const selfShare = span.duration_ms ? Math.min(span.self_ms / span.duration_ms, 1) : 1
          const isBottleneck = span.span_id === trace.bottleneck_span_id
          const isSelected = span.span_id === selected
          const error = span.status === 'error'
          return (
            <li key={span.span_id} role="treeitem" aria-level={span.depth + 1} aria-selected={isSelected}>
              <button
                type="button"
                onClick={() => onSelect(span.span_id)}
                className={`grid w-full grid-cols-[minmax(260px,38%)_1fr] items-center gap-2 border-b border-line px-3 py-1.5 text-left text-sm hover:bg-paper-2 ${
                  isSelected ? 'bg-accent-soft' : ''
                }`}
              >
                <span
                  className="flex min-w-0 items-center gap-1.5"
                  style={{ paddingLeft: criticalOnly ? 0 : span.depth * 14 }}
                >
                  {error && (
                    <svg width="10" height="10" viewBox="0 0 12 12" aria-label="error" className="shrink-0">
                      <rect x="1" y="1" width="10" height="10" rx="2" fill="var(--danger-mark)" />
                    </svg>
                  )}
                  <span className={`truncate ${span.critical ? 'font-semibold' : ''}`}>{span.name}</span>
                  <span className="shrink-0 truncate text-xs text-faint">{span.service}</span>
                  {isBottleneck && (
                    <span className="shrink-0 rounded bg-warn-soft px-1.5 text-[10px] font-bold uppercase text-warn">
                      bottleneck
                    </span>
                  )}
                </span>
                <span className="relative h-5">
                  <span
                    className="absolute top-1 flex h-3 overflow-hidden rounded-sm"
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${span.name}: ${ms(span.duration_ms)} (self ${ms(span.self_ms)})`}
                  >
                    {/* Solid part = self time; lighter part = time spent in child spans. */}
                    <span
                      className={error ? 'bg-danger-mark' : span.critical ? 'bg-brand' : 'bg-faint'}
                      style={{ width: `${selfShare * 100}%` }}
                    />
                    <span
                      className={`flex-1 ${error ? 'bg-danger-mark/40' : span.critical ? 'bg-brand/35' : 'bg-faint/40'}`}
                    />
                  </span>
                  <span
                    className="absolute top-0.5 whitespace-nowrap pl-1 font-mono text-[11px] text-muted"
                    style={{ left: `${Math.min(left + width, 88)}%` }}
                  >
                    {ms(span.duration_ms)}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="flex flex-wrap gap-x-5 gap-y-1 px-3 py-2 text-xs text-muted">
        <span>
          <span className="mr-1.5 inline-block h-2.5 w-5 rounded-sm bg-brand align-middle" aria-hidden="true" />
          self time, critical path
        </span>
        <span>
          <span className="mr-1.5 inline-block h-2.5 w-5 rounded-sm bg-brand/35 align-middle" aria-hidden="true" />
          waiting on child spans
        </span>
        <span>
          <span className="mr-1.5 inline-block h-2.5 w-5 rounded-sm bg-faint/60 align-middle" aria-hidden="true" />
          not on the critical path
        </span>
      </p>
    </div>
  )
}

export function SpanDetails({ span, traceId }: { span: Span; traceId: string }) {
  const groups: [string, Record<string, unknown>][] = [
    ['Span attributes', span.attributes],
    ['Resource attributes', span.resource],
  ]
  return (
    <aside className="card space-y-4 p-4 text-sm" aria-label="Span details">
      <div>
        <p className="font-mono text-xs text-faint">
          {KIND_LABEL[span.kind]} · {span.service}
        </p>
        <h3 className="mt-0.5 break-all text-base font-semibold">{span.name}</h3>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-muted">Duration</dt>
            <dd className="font-mono font-semibold">{ms(span.duration_ms)}</dd>
          </div>
          <div>
            <dt className="text-muted">Self time</dt>
            <dd className="font-mono font-semibold">{ms(span.self_ms)}</dd>
          </div>
          <div>
            <dt className="text-muted">Status</dt>
            <dd className={`font-mono font-semibold ${span.status === 'error' ? 'text-danger' : ''}`}>
              {span.status.toUpperCase()}
            </dd>
          </div>
        </dl>
        {span.status_message && (
          <p className="mt-2 rounded-md bg-danger-soft px-2 py-1 font-mono text-xs text-danger">
            {span.status_message}
          </p>
        )}
        <p className="mt-2 font-mono text-[11px] text-faint">span_id {span.span_id}</p>
      </div>

      <a
        href={`/logs/?trace_id=${traceId}&service=${span.service}`}
        className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
      >
        Logs from {span.service} in this trace →
      </a>

      {span.events.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Events</h4>
          <ul className="mt-1.5 space-y-2">
            {span.events.map((event, i) => (
              <li key={i} className="rounded-lg border border-line p-2">
                <p className="font-mono text-xs">
                  <span className={event.name === 'exception' ? 'font-semibold text-danger' : 'font-semibold'}>
                    {event.name}
                  </span>{' '}
                  <span className="text-faint">at {ms(event.offset_ms)}</span>
                </p>
                <AttributeList values={event.attributes} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.map(([title, values]) => (
        <div key={title}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
          <AttributeList values={values} />
        </div>
      ))}
    </aside>
  )
}

function AttributeList({ values }: { values: Record<string, unknown> }) {
  const entries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b))
  if (!entries.length) return <p className="mt-1 text-xs text-faint">None</p>
  return (
    <dl className="mt-1.5 space-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[minmax(0,42%)_1fr] gap-2 font-mono text-xs">
          <dt className="truncate text-muted" title={key}>
            {key}
          </dt>
          <dd className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all">{String(value)}</dd>
        </div>
      ))}
    </dl>
  )
}
