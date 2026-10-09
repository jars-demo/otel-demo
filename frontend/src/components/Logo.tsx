// The mark is a trace waterfall: a root span and its children, the shape this lab is about.
export function Logo({ size = 30, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--brand)" />
        <rect x="6" y="8" width="20" height="3.5" rx="1.75" fill="#fff" />
        <rect x="9" y="14.25" width="9" height="3.5" rx="1.75" fill="#fff" opacity="0.85" />
        <rect x="15" y="20.5" width="11" height="3.5" rx="1.75" fill="#fde68a" />
      </svg>
      {withText && (
        <span className="leading-tight">
          <span className="block text-[15px] font-bold tracking-tight">Incident Lab</span>
          <span className="block font-mono text-[11px] text-muted">OpenTelemetry</span>
        </span>
      )}
    </span>
  )
}
