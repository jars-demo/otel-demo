'use client'

import { useEffect, useState } from 'react'

import { lab, usePoll } from '@/lib/api'
import { useStoredState } from '@/lib/hooks'
import { ms, percent } from '@/lib/format'
import { IS_STATIC_SITE } from '@/lib/site'
import type { Incident, IncidentRun, LabStatus, Verification } from '@/lib/types'

import { LocalOnly } from '../LiveGate'
import { Badge, Button, ErrorNote } from '../ui'

// The learner's own progress on an incident: in this browser only, never sent anywhere.
type Progress = { steps: string[]; answer: string | null; attempts: number; revealed: boolean }
const EMPTY: Progress = { steps: [], answer: null, attempts: 0, revealed: false }

function useProgress(id: string) {
  return useStoredState<Progress>(`otel-demo:incident:${id}`, EMPTY)
}

const PHASES: { id: IncidentRun['phase']; label: string }[] = [
  { id: 'baseline', label: 'Measure baseline' },
  { id: 'active', label: 'Investigate' },
  { id: 'mitigated', label: 'Fix applied' },
  { id: 'resolved', label: 'Recovery verified' },
]

function PhaseBar({ run }: { run: IncidentRun | null }) {
  const current = run ? PHASES.findIndex((p) => p.id === run.phase) : -1
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Incident phases">
      {PHASES.map((phase, i) => (
        <li
          key={phase.id}
          aria-current={i === current ? 'step' : undefined}
          className={`rounded-lg border px-3 py-2 text-sm ${
            i < current
              ? 'border-ok/40 bg-ok-soft text-ok'
              : i === current
                ? 'border-accent bg-accent-soft font-semibold text-accent'
                : 'border-line text-muted'
          }`}
        >
          <span className="font-mono text-xs">{i + 1}</span> {phase.label}
        </li>
      ))}
    </ol>
  )
}

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <span className="font-mono">{Math.max(0, Math.ceil(until - now))} s</span>
}

function VerificationResult({ result }: { result: Verification }) {
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${result.passed ? 'border-ok/40 bg-ok-soft' : 'border-warn/40 bg-warn-soft'}`}
    >
      <p className={`font-semibold ${result.passed ? 'text-ok' : 'text-warn'}`}>
        {result.passed ? 'Recovery verified.' : 'Not recovered yet.'}
      </p>
      <ul className="mt-2 space-y-1">
        {result.checks.map((check) => (
          <li key={check.name} className="flex items-center gap-2">
            <span aria-hidden="true">{check.passed ? '✓' : '✗'}</span>
            <span className="sr-only">{check.passed ? 'passed' : 'failed'}:</span>
            {check.name}
          </li>
        ))}
      </ul>
      <p className="mt-2 font-mono text-xs text-muted">
        now: p95 {ms(result.current.p95_ms)}, errors {percent(result.current.error_ratio)} · baseline: p95{' '}
        {ms(result.baseline?.p95_ms)}, errors {percent(result.baseline?.error_ratio)}
      </p>
      {!result.passed && (
        <p className="mt-1 text-xs text-muted">
          Rates use a 30 s window: wait half a minute after the fix, then verify again.
        </p>
      )}
    </div>
  )
}

export function IncidentRunner({ incident }: { incident: Incident }) {
  const status = usePoll<LabStatus>(IS_STATIC_SITE ? null : '/lab/status', 2_000)
  const [progress, setProgress] = useProgress(incident.id)
  const [hints, setHints] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = status.data?.incident?.id === incident.id ? status.data.incident : null
  const otherRunning = status.data?.incident && !run ? status.data.incident.id : null
  const verification = run?.verification ?? null
  const correct = incident.question.options.find((o) => o.correct)
  const answered = incident.question.options.find((o) => o.id === progress.answer)
  const solved = answered?.correct ?? false
  const showAnswer = solved || progress.revealed

  async function act(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await status.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function toggleStep(id: string) {
    const steps = progress.steps.includes(id) ? progress.steps.filter((s) => s !== id) : [...progress.steps, id]
    setProgress({ ...progress, steps })
  }

  const scoreItems = [
    ...incident.investigation
      .filter((s) => s.id !== 'root-cause')
      .map((s) => ({ label: s.title, done: progress.steps.includes(s.id) })),
    { label: 'Identified the root cause', done: solved },
    { label: 'Verified recovery', done: run?.phase === 'resolved' || Boolean(verification?.passed) },
  ]
  const score = scoreItems.filter((i) => i.done).length

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
      <div className="min-w-0 space-y-8">
        <section aria-labelledby="symptom">
          <h2 id="symptom" className="text-xs font-bold uppercase tracking-widest text-danger">
            Symptom
          </h2>
          <p className="mt-2 whitespace-pre-line text-lg leading-relaxed">{incident.symptom}</p>
          {incident.slo && (
            <p className="mt-3 text-sm text-muted">
              <strong className="font-semibold text-text">SLO:</strong> {incident.slo.objective}.{' '}
              <span className="text-faint">SLI: {incident.slo.sli}.</span>
            </p>
          )}
        </section>

        <section aria-labelledby="run" className="space-y-4">
          <h2 id="run" className="text-xl font-[650]">
            Run the incident
          </h2>
          {IS_STATIC_SITE ? (
            <LocalOnly what="Running an incident" />
          ) : (
            <>
              <PhaseBar run={run} />
              {error && <ErrorNote message={error} />}
              {status.error && <ErrorNote message={status.error} />}
              {otherRunning && (
                <p className="text-sm text-warn">{otherRunning} is running. Starting this one stops it.</p>
              )}
              {!run && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    disabled={busy}
                    onClick={() => void act(() => lab.post(`/lab/incidents/${incident.id}/start`))}
                  >
                    Start investigation
                  </Button>
                  <span className="text-sm text-muted">
                    Starts {incident.trigger.load.rps} req/s of {incident.trigger.load.scenario} traffic, measures a
                    baseline, then injects the incident. You are not told what changed: that is what you investigate.
                  </span>
                </div>
              )}
              {run?.phase === 'baseline' && (
                <p className="rounded-lg bg-paper-2 px-3 py-2 text-sm">
                  Traffic is flowing and the lab is measuring normal behaviour. The incident begins in{' '}
                  <Countdown until={run.baseline_until} />. Open the Metrics page now and note the healthy numbers.
                </p>
              )}
              {run && run.phase !== 'baseline' && run.baseline && (
                <p className="font-mono text-xs text-muted">
                  Baseline (api-gateway): p95 {ms(run.baseline.p95_ms)} · errors {percent(run.baseline.error_ratio)} ·{' '}
                  {run.baseline.rps} req/s
                </p>
              )}
              {run?.phase === 'active' && (
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone="danger">Incident in progress</Badge>
                  <span className="text-sm text-muted">Investigate below. When you know the cause, apply the fix.</span>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void act(() => lab.post('/lab/incidents/mitigate'))}
                  >
                    Apply fix
                  </Button>
                </div>
              )}
              {(run?.phase === 'mitigated' || run?.phase === 'resolved') && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={busy} onClick={() => void act(() => lab.post('/lab/incidents/verify'))}>
                    Verify recovery
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void act(() => lab.post('/lab/incidents/stop'))}
                  >
                    End incident
                  </Button>
                </div>
              )}
              {run?.phase === 'active' && (
                <p className="text-xs text-faint">
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void act(() => lab.post('/lab/incidents/stop'))}
                  >
                    Abort
                  </button>{' '}
                  stops traffic and clears every fault.
                </p>
              )}
              {verification && <VerificationResult result={verification} />}
            </>
          )}
        </section>

        <section aria-labelledby="investigate">
          <h2 id="investigate" className="text-xl font-[650]">
            Investigate
          </h2>
          <ol className="mt-4 space-y-3">
            {incident.investigation.map((step, i) => {
              const done = progress.steps.includes(step.id)
              const hintShown = hints.includes(step.id)
              if (step.id === 'root-cause') return null
              return (
                <li key={step.id} className={`card p-4 ${done ? 'border-ok/50' : ''}`}>
                  <div className="flex items-start gap-3">
                    <input
                      id={`step-${step.id}`}
                      type="checkbox"
                      checked={done}
                      onChange={() => toggleStep(step.id)}
                      className="mt-1 size-4 shrink-0 accent-[var(--ok-mark)]"
                    />
                    <div className="min-w-0 flex-1">
                      <label htmlFor={`step-${step.id}`} className="font-semibold">
                        <span className="font-mono text-sm text-faint">{i + 1}.</span> {step.title}
                      </label>
                      <p className="mt-1 text-sm text-muted">{step.task}</p>
                      <div className="mt-2 flex flex-wrap gap-4 text-sm">
                        {step.where && (
                          <a
                            href={step.where}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-accent hover:underline"
                          >
                            Open {step.where.replaceAll('/', '') || 'page'} →
                          </a>
                        )}
                        {step.hint && (
                          <button
                            type="button"
                            className="text-muted underline-offset-4 hover:underline"
                            aria-expanded={hintShown}
                            onClick={() =>
                              setHints(hintShown ? hints.filter((h) => h !== step.id) : [...hints, step.id])
                            }
                          >
                            {hintShown ? 'Hide hint' : 'Show hint'}
                          </button>
                        )}
                      </div>
                      {hintShown && <p className="mt-2 rounded-lg bg-paper-2 px-3 py-2 text-sm">{step.hint}</p>}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>

        <section aria-labelledby="question" className="card p-5">
          <h2 id="question" className="font-semibold">
            {incident.question.prompt}
          </h2>
          <fieldset className="mt-3 space-y-2">
            <legend className="sr-only">Choose the root cause</legend>
            {incident.question.options.map((option) => {
              const chosen = progress.answer === option.id
              return (
                <label
                  key={option.id}
                  className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2 text-sm ${
                    chosen
                      ? option.correct
                        ? 'border-ok bg-ok-soft'
                        : 'border-danger bg-danger-soft'
                      : 'border-line hover:border-accent'
                  }`}
                >
                  <input
                    type="radio"
                    name={`q-${incident.id}`}
                    checked={chosen}
                    disabled={solved}
                    onChange={() => setProgress({ ...progress, answer: option.id, attempts: progress.attempts + 1 })}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span>
                    {option.text}
                    {chosen && (
                      <span className={`mt-1 block text-xs ${option.correct ? 'text-ok' : 'text-danger'}`}>
                        {option.feedback}
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
          </fieldset>
          {!showAnswer && progress.attempts > 0 && (
            <button
              type="button"
              className="mt-3 text-sm text-muted underline"
              onClick={() => setProgress({ ...progress, revealed: true })}
            >
              I am stuck: show the answer
            </button>
          )}
          {!showAnswer && progress.attempts === 0 && (
            <p className="mt-3 text-xs text-faint">The full write-up appears once you have answered.</p>
          )}
        </section>

        {showAnswer && correct && (
          <section aria-labelledby="rootcause" className="card border-ok/50 p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-ok">Root cause found</p>
            <h2 id="rootcause" className="mt-1 text-lg font-semibold">
              {incident.answer.root_cause}
            </h2>
            <div className="mt-4 grid gap-5 text-sm md:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Evidence</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {incident.answer.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-3">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Remediation</h3>
                  <p className="mt-1">{incident.answer.remediation}</p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Verification</h3>
                  <p className="mt-1">{incident.answer.verification}</p>
                </div>
              </div>
            </div>
            <dl className="mt-5 grid gap-3 text-sm md:grid-cols-3">
              {(['traces', 'metrics', 'logs'] as const).map((signal) => (
                <div key={signal} className="rounded-lg bg-paper-2 p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{signal}</dt>
                  <dd className="mt-1">{incident.answer.expected_telemetry[signal]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 border-l-4 border-accent pl-3 text-sm font-medium">{incident.answer.lesson}</p>
          </section>
        )}
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Investigation</p>
          <p className="mt-1 font-mono text-2xl font-semibold">
            {score}/{scoreItems.length}
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {scoreItems.map((item) => (
              <li key={item.label} className={`flex gap-2 ${item.done ? 'text-text' : 'text-faint'}`}>
                <span aria-hidden="true" className={item.done ? 'text-ok' : ''}>
                  {item.done ? '✓' : '○'}
                </span>
                <span className="sr-only">{item.done ? 'done:' : 'not done:'}</span>
                {item.label}
              </li>
            ))}
          </ul>
          <button type="button" className="mt-4 text-xs text-muted underline" onClick={() => setProgress(EMPTY)}>
            Reset my progress
          </button>
        </div>
      </aside>
    </div>
  )
}
