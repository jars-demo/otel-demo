import { highlight } from '@/lib/markdown'

import { CopyButton } from './CopyButton'

const LABELS: Record<string, string> = {
  bash: 'Terminal',
  sh: 'Terminal',
  powershell: 'PowerShell',
  python: 'Python',
  json: 'JSON',
  toml: 'TOML',
  yaml: 'YAML',
  dockerfile: 'Dockerfile',
  text: 'Output',
}

// A highlighted, copyable code block, rendered at build time.
export async function CodeBlock({
  code,
  lang,
  title,
  numbered = false,
  wrap = false,
}: {
  code: string
  lang?: string
  title?: string
  numbered?: boolean
  wrap?: boolean
}) {
  const html = await highlight(code, lang)
  const label = title ?? LABELS[lang ?? 'text'] ?? lang ?? 'Code'
  return (
    <figure
      className={`overflow-hidden rounded-xl border border-line bg-paper-2 ${numbered ? 'numbered' : ''} ${wrap ? 'wrap' : ''}`}
    >
      <figcaption className="flex items-center justify-between border-b border-line px-3 py-1.5 text-xs font-medium text-muted">
        <span>{label}</span>
        <CopyButton text={code.replace(/\n$/, '')} />
      </figcaption>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </figure>
  )
}
