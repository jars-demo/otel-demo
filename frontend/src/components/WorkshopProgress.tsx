'use client'

import { useSyncExternalStore } from 'react'

import { useIsClient } from '@/lib/hooks'

import { CHAPTERS } from '@/lib/chapters'

// Completed chapters live in this browser's localStorage. Nothing is sent anywhere.
const KEY = 'otel-demo:completed'
const EVENT = 'otel-demo:progress'

function read(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

function write(slugs: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(slugs))
  } catch {
    // Storage blocked: progress is not remembered, everything else works.
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

let snapshot = '[]'
function getSnapshot() {
  const next = JSON.stringify(read())
  if (next !== snapshot) snapshot = next
  return snapshot
}

export function useCompleted(): string[] {
  const value = useSyncExternalStore(subscribe, getSnapshot, () => '[]')
  return JSON.parse(value) as string[]
}

export function ProgressBar() {
  const done = useCompleted().filter((slug) => CHAPTERS.some((c) => c.slug === slug)).length
  const percent = Math.round((done / CHAPTERS.length) * 100)
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs font-medium text-muted">
        <span>Your progress</span>
        <span>
          {done}/{CHAPTERS.length}
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-paper-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Workshop progress"
      >
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      {done === CHAPTERS.length && (
        <p className="mt-3 rounded-lg bg-ok-soft px-3 py-2 text-sm font-medium text-ok">
          Workshop complete. Nice work.
        </p>
      )}
    </div>
  )
}

export function ChapterList({ current }: { current?: string }) {
  const completed = useCompleted()
  return (
    <ol className="space-y-0.5">
      {CHAPTERS.map((chapter) => {
        const done = completed.includes(chapter.slug)
        const active = chapter.slug === current
        return (
          <li key={chapter.slug}>
            <a
              href={`/workshop/${chapter.slug}/`}
              aria-current={active ? 'page' : undefined}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-paper-2 hover:text-text aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold aria-[current=page]:text-accent"
            >
              <span
                aria-hidden="true"
                className={`grid size-6 shrink-0 place-items-center rounded-full font-mono text-[11px] ${done ? 'bg-ok text-white' : 'border border-line bg-paper'}`}
              >
                {done ? '✓' : chapter.number}
              </span>
              <span>
                {chapter.title}
                {done && <span className="sr-only"> (completed)</span>}
              </span>
            </a>
          </li>
        )
      })}
    </ol>
  )
}

export function CompleteButton({ slug }: { slug: string }) {
  const completed = useCompleted()
  const mounted = useIsClient()
  const done = completed.includes(slug)

  function toggle() {
    const current = read()
    write(done ? current.filter((s) => s !== slug) : [...current, slug])
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!mounted}
      aria-pressed={done}
      className={`rounded-lg px-4 py-2 text-sm font-semibold ${done ? 'border border-ok bg-ok-soft text-ok' : 'bg-brand text-white hover:bg-brand-hover'}`}
    >
      {done ? '✓ Completed' : 'Mark chapter complete'}
    </button>
  )
}
