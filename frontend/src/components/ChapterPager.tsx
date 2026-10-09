'use client'

import { useEffect } from 'react'

import type { Chapter } from '@/lib/chapters'

type Props = { previous?: Chapter; next?: Chapter; index: number; total: number; compact?: boolean }

const href = (chapter: Chapter) => `/workshop/${chapter.slug}/`

// Previous / next between chapters, with ← and → keyboard shortcuts (ignored while typing).
export function ChapterPager({ previous, next, index, total, compact = false }: Props) {
  useEffect(() => {
    if (compact) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'ArrowLeft' && previous) window.location.href = href(previous)
      if (event.key === 'ArrowRight' && next) window.location.href = href(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previous, next, compact])

  const button =
    'inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent'
  const disabled = 'inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-faint'

  if (compact) {
    return (
      <nav aria-label="Chapter pagination" className="flex items-center gap-2">
        {previous ? (
          <a href={href(previous)} className={button} aria-label={`Previous: ${previous.title}`}>
            ←
          </a>
        ) : (
          <span className={disabled} aria-hidden="true">
            ←
          </span>
        )}
        <span className="font-mono text-xs text-muted">
          {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
        {next ? (
          <a href={href(next)} className={button} aria-label={`Next: ${next.title}`}>
            →
          </a>
        ) : (
          <span className={disabled} aria-hidden="true">
            →
          </span>
        )}
      </nav>
    )
  }

  return (
    <nav aria-label="Chapter pagination" className="grid gap-3 sm:grid-cols-2">
      {previous ? (
        <a href={href(previous)} className="card p-4 hover:border-accent">
          <span className="text-xs text-faint">← Previous</span>
          <span className="mt-1 block font-semibold">
            {previous.number} · {previous.title}
          </span>
        </a>
      ) : (
        <span className="hidden sm:block" />
      )}
      {next ? (
        <a href={href(next)} className="card p-4 text-right hover:border-accent">
          <span className="text-xs text-faint">Next →</span>
          <span className="mt-1 block font-semibold">
            {next.number} · {next.title}
          </span>
        </a>
      ) : (
        <a href="/incidents/" className="card p-4 text-right hover:border-accent">
          <span className="text-xs text-faint">Done →</span>
          <span className="mt-1 block font-semibold">Back to the Incident Lab</span>
        </a>
      )}
      <p className="text-xs text-faint sm:col-span-2">
        Tip: use <kbd className="rounded border border-line px-1 font-mono">←</kbd> and{' '}
        <kbd className="rounded border border-line px-1 font-mono">→</kbd> to move between chapters.
      </p>
    </nav>
  )
}
