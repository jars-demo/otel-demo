'use client'

import { useMemo, useState } from 'react'

import { ms } from '@/lib/format'

function SimulationLabel() {
  return (
    <span className="rounded-md border border-warn/40 bg-warn-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warn">
      Educational simulation, not live data
    </span>
  )
}

// A seeded generator so the simulation is the same on every visit: 1000 synthetic requests,
// mostly fast, a slow tail, and a few errors. Shapes, not measurements.
function syntheticRequests(count = 1000) {
  let seed = 42
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  return Array.from({ length: count }, (_, i) => {
    const slow = next() < 0.04
    const error = next() < 0.015
    const duration = slow ? 1000 + next() * 3000 : 60 + next() * 240
    return { id: i, duration, error }
  })
}

export function SamplingSimulator() {
  const requests = useMemo(() => syntheticRequests(), [])
  const [mode, setMode] = useState<'head' | 'tail'>('head')
  const [percent, setPercent] = useState(10)

  const kept = requests.filter((r) =>
    mode === 'head'
      ? r.id % Math.round(100 / percent) === 0
      : r.error || r.duration > 1000 || r.id % Math.round(100 / percent) === 0,
  )
  const interesting = requests.filter((r) => r.error || r.duration > 1000)
  const keptInteresting = kept.filter((r) => r.error || r.duration > 1000)

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">1000 requests, one sampling policy</h3>
        <SimulationLabel />
      </div>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <fieldset className="flex gap-3">
          <legend className="sr-only">Sampling policy</legend>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={mode === 'head'}
              onChange={() => setMode('head')}
              className="accent-[var(--accent)]"
            />
            Head sampling
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={mode === 'tail'}
              onChange={() => setMode('tail')}
              className="accent-[var(--accent)]"
            />
            Tail sampling
          </label>
        </fieldset>
        <label className="flex items-center gap-2">
          Keep
          <select
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
            className="h-8 rounded-md border border-line bg-paper px-2"
          >
            {[1, 5, 10, 25, 50, 100].map((p) => (
              <option key={p} value={p}>
                {p}%
              </option>
            ))}
          </select>
          {mode === 'tail' && 'of normal traces, plus every error and slow trace'}
        </label>
      </div>

      <div
        className="grid grid-cols-[repeat(50,minmax(0,1fr))] gap-[2px]"
        role="img"
        aria-label={`${kept.length} of 1000 traces kept`}
      >
        {requests.map((r) => {
          const isKept = kept.includes(r)
          const color = r.error ? 'bg-danger-mark' : r.duration > 1000 ? 'bg-warn-mark' : 'bg-brand'
          return <span key={r.id} className={`aspect-square rounded-[2px] ${isKept ? color : 'bg-paper-2'}`} />
        })}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm bg-brand align-middle" />
          normal, kept
        </span>
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm bg-warn-mark align-middle" />
          slow (&gt; 1 s), kept
        </span>
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm bg-danger-mark align-middle" />
          error, kept
        </span>
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm border border-line bg-paper-2 align-middle" />
          dropped
        </span>
      </p>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Traces stored</dt>
          <dd className="font-mono text-lg font-semibold">{kept.length} / 1000</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Errors and slow traces kept</dt>
          <dd className="font-mono text-lg font-semibold">
            {keptInteresting.length} / {interesting.length}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Storage vs keeping all</dt>
          <dd className="font-mono text-lg font-semibold">{kept.length / 10}%</dd>
        </div>
      </dl>
      <p className="text-sm text-muted">
        {mode === 'head'
          ? 'Head sampling decides when a trace starts, before anyone knows whether it will fail. It is cheap and simple, and it throws away most of the traces you will want during an incident.'
          : 'Tail sampling decides after the trace is complete, so it can keep every error and every slow request. The price: a Collector must hold whole traces in memory, and all spans of a trace must reach the same Collector.'}
      </p>
    </div>
  )
}

export function BatchingDemo() {
  const [batchSize, setBatchSize] = useState(100)
  const items = 1000
  const requests = Math.ceil(items / batchSize)
  const overheadMs = 2 // per request: headers, TLS record, round trip bookkeeping

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Exporting 1000 spans</h3>
        <SimulationLabel />
      </div>
      <label className="flex items-center gap-3 text-sm">
        Batch size
        <input
          type="range"
          min={1}
          max={1000}
          step={1}
          value={batchSize}
          onChange={(e) => setBatchSize(Number(e.target.value))}
          className="w-56 accent-[var(--accent)]"
          aria-valuetext={`${batchSize} spans per request`}
        />
        <span className="font-mono">{batchSize}</span>
      </label>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Export requests</dt>
          <dd className="font-mono text-lg font-semibold">{requests}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Overhead (model)</dt>
          <dd className="font-mono text-lg font-semibold">{ms(requests * overheadMs)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Fewer requests than unbatched</dt>
          <dd className="font-mono text-lg font-semibold">{Math.round((1 - requests / items) * 1000) / 10}%</dd>
        </div>
      </dl>
      <p className="text-sm text-muted">
        A toy cost model: {overheadMs} ms of fixed cost per request. One span per request pays the fixed cost 1000
        times. Batching pays it {requests} {requests === 1 ? 'time' : 'times'}, compresses better and makes fewer
        connections. The trade-off is delivery delay: an item waits until the batch fills or the timeout (2 s here)
        fires, and a crash loses what was still buffered.
      </p>
    </div>
  )
}
