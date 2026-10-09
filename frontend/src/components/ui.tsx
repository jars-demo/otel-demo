import type { ReactNode } from 'react'

import type { Health } from '@/lib/types'

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="max-w-3xl">
      {eyebrow && <p className="font-mono text-sm font-semibold text-accent">{eyebrow}</p>}
      <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      {children && <div className="mt-3 text-lg leading-relaxed text-muted">{children}</div>}
    </header>
  )
}

export function Section({
  title,
  id,
  children,
  aside,
}: {
  title: string
  id?: string
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <section id={id} className="mt-12 scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-[650] tracking-tight">{title}</h2>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

const HEALTH: Record<Health, { label: string; className: string; icon: ReactNode }> = {
  healthy: {
    label: 'Healthy',
    className: 'text-ok',
    icon: <circle cx="6" cy="6" r="5" fill="var(--ok-mark)" />,
  },
  degraded: {
    label: 'Degraded',
    className: 'text-warn',
    icon: <path d="M6 1 L11 11 L1 11 Z" fill="var(--warn-mark)" />,
  },
  unhealthy: {
    label: 'Unhealthy',
    className: 'text-danger',
    icon: <rect x="1" y="1" width="10" height="10" rx="2" fill="var(--danger-mark)" />,
  },
  idle: {
    label: 'No traffic',
    className: 'text-faint',
    icon: <circle cx="6" cy="6" r="4.5" fill="none" stroke="var(--faint)" strokeWidth="1.5" />,
  },
}

/** Health is shape + label + colour, never colour alone. */
export function HealthBadge({ health, compact = false }: { health: Health; compact?: boolean }) {
  const h = HEALTH[health]
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${h.className}`}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        {h.icon}
      </svg>
      {compact ? <span className="sr-only">{h.label}</span> : h.label}
    </span>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'
}) {
  const tones = {
    neutral: 'border-line bg-paper-2 text-muted',
    accent: 'border-transparent bg-accent-soft text-accent',
    ok: 'border-transparent bg-ok-soft text-ok',
    warn: 'border-transparent bg-warn-soft text-warn',
    danger: 'border-transparent bg-danger-soft text-danger',
  }
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'danger' | 'warn'
}) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-text'
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  const variants = {
    primary: 'bg-brand text-white hover:bg-brand-hover',
    secondary: 'border border-line bg-paper text-text hover:border-accent hover:text-accent',
    danger: 'border border-danger text-danger hover:bg-danger-soft',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]}`}
    >
      {children}
    </button>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</p>
  )
}
