import { ImageResponse } from 'next/og'

export const dynamic = 'force-static'
export const alt = 'OpenTelemetry Incident Lab: Break it. Trace it. Find it. Fix it.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const ROWS = [
  { label: 'POST /api/checkout', left: 0, width: 100, hot: false },
  { label: 'order.reserve_inventory', left: 46, width: 45, hot: false },
  { label: 'EVALSHA  redis', left: 46, width: 44, hot: true },
]

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: 'linear-gradient(180deg, #EFF6FF 0%, #FFFFFF 70%)',
        fontFamily: 'sans-serif',
        color: '#0F172A',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 30, color: '#2563EB', fontWeight: 700 }}>OpenTelemetry Incident Lab</div>
        <div style={{ fontSize: 76, fontWeight: 800, marginTop: 18, lineHeight: 1.05 }}>Break it. Trace it.</div>
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05 }}>Find it. Fix it.</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {ROWS.map((row) => (
          <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <div style={{ width: 360, fontSize: 24, color: row.hot ? '#B45309' : '#475569' }}>{row.label}</div>
            <div style={{ display: 'flex', flex: 1, height: 22 }}>
              <div style={{ width: `${row.left}%` }} />
              <div style={{ width: `${row.width}%`, background: row.hot ? '#D97706' : '#2563EB', borderRadius: 6 }} />
            </div>
          </div>
        ))}
        <div style={{ fontSize: 22, color: '#64748B', marginTop: 12 }}>
          Traces · Metrics · Logs · Collector · Tempo · Prometheus · Loki · Grafana
        </div>
      </div>
    </div>,
    size,
  )
}
