// Shapes of the lab-console API (services/lab) and the incident definitions (incidents/*.yaml).

export type Health = 'healthy' | 'degraded' | 'unhealthy' | 'idle'

export type ServiceMetrics = {
  rps: number | null
  error_ratio: number | null
  p50_ms: number | null
  p95_ms: number | null
  p99_ms: number | null
  health: Health
}

export type MapNode = {
  id: string
  type: 'service' | 'datastore'
  rps: number | null
  error_ratio: number | null
  p50_ms?: number | null
  p95_ms: number | null
  p99_ms?: number | null
  health: Health
}

export type MapEdge = {
  source: string
  target: string
  rps: number | null
  error_ratio: number | null
  p95_ms: number | null
}

export type ServiceMap = { window: string; nodes: MapNode[]; edges: MapEdge[] }

export type Point = [number, number | null]

export type TimeSeries = {
  step_s: number
  minutes: number
  series: Record<'rps' | 'errors' | 'p95_ms', Record<string, Point[]>>
}

export type PoolMetrics = Record<
  string,
  { used?: number; idle?: number; max?: number; pending?: number; wait_p95_ms?: number; timeouts_per_s?: number }
>

export type TraceSummary = {
  trace_id: string
  root_name: string | null
  root_service: string | null
  start_unix_ms: number
  duration_ms: number
  http_status_code: number | null
  status: 'ok' | 'error'
}

export type SpanEvent = { name: string; attributes: Record<string, unknown>; offset_ms: number }

export type Span = {
  span_id: string
  parent_id: string | null
  name: string
  service: string
  kind: 'server' | 'client' | 'internal' | 'producer' | 'consumer'
  status: 'ok' | 'error' | 'unset'
  status_message: string | null
  attributes: Record<string, unknown>
  resource: Record<string, unknown>
  events: SpanEvent[]
  depth: number
  critical: boolean
  offset_ms: number
  duration_ms: number
  self_ms: number
}

export type Trace = {
  trace_id: string
  incomplete: boolean
  root_name: string
  root_service: string
  start_unix_ms: number
  duration_ms: number
  status: 'ok' | 'error'
  http_status_code: number | null
  services: string[]
  span_count: number
  bottleneck_span_id: string
  spans: Span[]
}

export type LogEntry = {
  timestamp_ns: number
  severity: string
  service: string | null
  message: string
  trace_id: string | null
  span_id: string | null
  logger: string | null
  attributes: Record<string, string>
}

export type Fault = {
  id: string
  label: string
  description: string
  target: string
  kind: 'int' | 'bool'
  unit: string
  max: number
  value: number | boolean | null
}

export type LoadStatus = {
  running: boolean
  config: { scenario: string; rps: number; duration_s: number } | null
  elapsed_s: number
  sent: number
  statuses: Record<string, number>
  client_latency_ms: { p50: number | null; p95: number | null }
  limits: { max_rps: number; max_duration_s: number }
}

export type Snapshot = { rps: number | null; p95_ms: number | null; error_ratio: number | null; measured_at: number }

export type Verification = {
  passed: boolean
  checks: { name: string; passed: boolean }[]
  baseline: Snapshot | null
  current: Snapshot
}

export type IncidentRun = {
  id: string
  phase: 'baseline' | 'active' | 'mitigated' | 'resolved'
  started_at: number
  baseline_until: number
  baseline: Snapshot | null
  injected_at: number | null
  mitigated_at: number | null
  verification: Verification | null
  elapsed_s: number
}

export type LabStatus = {
  components: Record<string, 'up' | 'down' | 'not_ready'>
  incident: IncidentRun | null
  load: LoadStatus
}

// --- incidents/*.yaml --------------------------------------------------------------------------

export type InvestigationStep = { id: string; title: string; task: string; hint?: string; where?: string }

export type Incident = {
  id: string
  slug: string
  title: string
  severity: string
  summary: string
  symptom: string
  challenge?: boolean
  trigger: { faults: Record<string, number | boolean>; load: { scenario: string; rps: number; duration_s: number } }
  slo?: { sli: string; objective: string }
  investigation: InvestigationStep[]
  question: { prompt: string; options: { id: string; text: string; correct: boolean; feedback: string }[] }
  answer: {
    root_cause: string
    evidence: string[]
    expected_telemetry: { traces: string; metrics: string; logs: string }
    remediation: string
    verification: string
    lesson: string
  }
}
