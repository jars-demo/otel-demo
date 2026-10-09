'use client'

import { useState } from 'react'

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md border border-line bg-paper px-2 py-0.5 text-xs font-medium text-muted hover:text-text"
      aria-label={copied ? 'Copied to clipboard' : `${label} to clipboard`}
    >
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  )
}
