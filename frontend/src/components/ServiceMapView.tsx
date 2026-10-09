'use client'

import { ms, percent, rate } from '@/lib/format'
import type { Health, MapEdge, MapNode, ServiceMap } from '@/lib/types'

// Fixed positions: the topology is small and known, so a hand layout reads better than a force
// layout that moves every refresh. Edges come from the data (Tempo service graph), not from here.
const POS: Record<string, [number, number]> = {
  'api-gateway': [360, 46],
  'order-service': [170, 166],
  'inventory-service': [550, 166],
  'payment-service': [170, 296],
  postgres: [360, 296],
  redis: [550, 296],
}
const STATIC_EDGES: [string, string][] = [
  ['api-gateway', 'order-service'],
  ['api-gateway', 'inventory-service'],
  ['order-service', 'inventory-service'],
  ['order-service', 'payment-service'],
  ['order-service', 'postgres'],
  ['payment-service', 'postgres'],
  ['inventory-service', 'redis'],
]
const W = 150
const H = 52

const STROKE: Record<Health, string> = {
  healthy: 'var(--ok-mark)',
  degraded: 'var(--warn-mark)',
  unhealthy: 'var(--danger-mark)',
  idle: 'var(--line)',
}

function HealthGlyph({ health, x, y }: { health: Health; x: number; y: number }) {
  if (health === 'healthy') return <circle cx={x} cy={y} r={5} fill={STROKE.healthy} />
  if (health === 'degraded')
    return <path d={`M${x} ${y - 5} L${x + 5} ${y + 5} L${x - 5} ${y + 5} Z`} fill={STROKE.degraded} />
  if (health === 'unhealthy') return <rect x={x - 5} y={y - 5} width={10} height={10} rx={2} fill={STROKE.unhealthy} />
  return <circle cx={x} cy={y} r={4.5} fill="none" stroke="var(--faint)" strokeWidth={1.5} />
}

function edgePath(from: string, to: string): [number, number, number, number] {
  const [x1, y1] = POS[from]
  const [x2, y2] = POS[to]
  // Leave from / arrive at the box edge facing the other node.
  const horizontal = Math.abs(y2 - y1) < 10
  if (horizontal) {
    const dir = Math.sign(x2 - x1)
    return [x1 + (dir * W) / 2, y1, x2 - (dir * W) / 2, y2]
  }
  const dir = Math.sign(y2 - y1)
  return [x1 + (x2 - x1) * 0.15, y1 + (dir * H) / 2, x2 - (x2 - x1) * 0.15, y2 - (dir * H) / 2]
}

export function ServiceMapView({
  data,
  selected,
  onSelect,
}: {
  data?: ServiceMap | null
  selected?: string | null
  onSelect?: (id: string) => void
}) {
  const nodes: MapNode[] =
    data?.nodes ??
    Object.keys(POS).map((id) => ({
      id,
      type: id === 'redis' || id === 'postgres' ? 'datastore' : 'service',
      rps: null,
      error_ratio: null,
      p95_ms: null,
      health: 'idle',
    }))
  const edges: MapEdge[] = data?.edges?.length
    ? data.edges
    : STATIC_EDGES.map(([source, target]) => ({ source, target, rps: null, error_ratio: null, p95_ms: null }))
  const live = Boolean(data)

  return (
    <figure className="card overflow-x-auto p-2">
      <svg viewBox="0 0 720 340" className="min-w-[560px]" role="img" aria-labelledby="map-title map-desc">
        <title id="map-title">Service map</title>
        <desc id="map-desc">
          api-gateway calls order-service and inventory-service. order-service calls inventory-service, payment-service
          and postgres. payment-service calls postgres. inventory-service calls redis.
        </desc>
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill="var(--faint)" />
          </marker>
        </defs>
        {edges
          .filter((e) => POS[e.source] && POS[e.target])
          .map((edge) => {
            const [x1, y1, x2, y2] = edgePath(edge.source, edge.target)
            const failing = (edge.error_ratio ?? 0) >= 0.01
            return (
              <g key={`${edge.source}-${edge.target}`}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={failing ? 'var(--danger-mark)' : 'var(--faint)'}
                  strokeWidth={failing ? 2 : 1.25}
                  strokeDasharray={live && !edge.rps ? '4 4' : undefined}
                  markerEnd="url(#arrow)"
                />
                {live && edge.rps !== null && (
                  <text
                    x={(x1 + x2) / 2 + 6}
                    y={(y1 + y2) / 2 - 4}
                    className="fill-[var(--muted)] font-mono text-[10px]"
                  >
                    {rate(edge.rps)}
                  </text>
                )}
              </g>
            )
          })}
        {nodes
          .filter((n) => POS[n.id])
          .map((node) => {
            const [cx, cy] = POS[node.id]
            const isSelected = selected === node.id
            const label = `${node.id}: ${node.health}${node.p95_ms !== null ? `, p95 ${ms(node.p95_ms)}` : ''}${
              node.error_ratio ? `, errors ${percent(node.error_ratio)}` : ''
            }`
            const interactive = Boolean(onSelect)
            return (
              <g
                key={node.id}
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={label}
                aria-pressed={interactive ? isSelected : undefined}
                onClick={() => onSelect?.(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect?.(node.id)
                  }
                }}
                className={
                  interactive ? 'cursor-pointer outline-none [&:focus-visible>rect]:stroke-[var(--accent)]' : undefined
                }
              >
                <rect
                  x={cx - W / 2}
                  y={cy - H / 2}
                  width={W}
                  height={H}
                  rx={node.type === 'datastore' ? 18 : 10}
                  fill="var(--paper)"
                  stroke={isSelected ? 'var(--accent)' : live ? STROKE[node.health] : 'var(--line)'}
                  strokeWidth={isSelected ? 2.5 : live && node.health !== 'idle' ? 2 : 1.25}
                />
                {live && <HealthGlyph health={node.health} x={cx - W / 2 + 14} y={cy - 9} />}
                <text
                  x={live ? cx - W / 2 + 26 : cx}
                  y={cy - 5}
                  textAnchor={live ? 'start' : 'middle'}
                  className="fill-[var(--text)] text-[12.5px] font-semibold"
                >
                  {node.id}
                </text>
                <text
                  x={live ? cx - W / 2 + 26 : cx}
                  y={cy + 13}
                  textAnchor={live ? 'start' : 'middle'}
                  className="fill-[var(--muted)] font-mono text-[10.5px]"
                >
                  {live
                    ? node.health === 'idle'
                      ? 'no traffic'
                      : `p95 ${ms(node.p95_ms)} · err ${percent(node.error_ratio)}`
                    : node.type === 'datastore'
                      ? node.id === 'redis'
                        ? 'cache · stock'
                        : 'orders · payments'
                      : 'FastAPI service'}
                </text>
              </g>
            )
          })}
      </svg>
      {live && (
        <figcaption className="px-3 pb-2 text-xs text-muted">
          Edges and data-store health come from Tempo&apos;s service-graph metrics; service health from each
          service&apos;s HTTP server metrics, over the last {data?.window}. Select a node for its traces, metrics and
          logs.
        </figcaption>
      )}
    </figure>
  )
}
