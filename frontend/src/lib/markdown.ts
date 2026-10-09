// Server-only helpers that turn the workshop's Markdown (at the repository root) into page data.
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { createHighlighter, type Highlighter } from 'shiki'

// frontend/ -> repository root. Next runs the build from frontend/.
export const REPO_ROOT = path.resolve(process.cwd(), '..')

export type ChapterContent = { meta: string | null; body: string }

// Reads workshop/<slug>.md. The `# Title` line becomes the page title, the `> ⏱ ...` line becomes
// the chapter meta, and the trailing `Next: [...]` line is dropped: the site has its own navigation.
export async function loadChapter(slug: string): Promise<ChapterContent> {
  const raw = await readFile(path.join(REPO_ROOT, 'workshop', `${slug}.md`), 'utf8')
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  if (lines[0]?.startsWith('# ')) lines.shift()

  let meta: string | null = null
  const start = lines.findIndex((line) => line.startsWith('> ⏱'))
  if (start !== -1) {
    // The meta blockquote may wrap onto following `> ` lines.
    let end = start + 1
    while (end < lines.length && lines[end].startsWith('> ')) end++
    meta = lines
      .slice(start, end)
      .map((line) => line.replace(/^>\s*(⏱\s*)?/, ''))
      .join(' ')
    lines.splice(start, end - start)
  }

  const body = lines.filter((line) => !line.startsWith('Next: [')).join('\n')
  return { meta, body: body.trim() }
}

// Long-form site pages (concepts, security, production) live in frontend/content/*.md.
export async function loadContent(name: string): Promise<string> {
  return (await readFile(path.join(process.cwd(), 'content', `${name}.md`), 'utf8')).replace(/\r\n/g, '\n')
}

export async function readRepoFile(relative: string): Promise<string> {
  return (await readFile(path.join(REPO_ROOT, relative), 'utf8')).replace(/\r\n/g, '\n')
}

// --- Syntax highlighting (build time) --------------------------------------------------------

const LANGS = [
  'bash',
  'powershell',
  'python',
  'json',
  'toml',
  'yaml',
  'dockerfile',
  'sql',
  'typescript',
  'text',
] as const
const ALIASES: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  console: 'bash',
  py: 'python',
  ps1: 'powershell',
  yml: 'yaml',
  ts: 'typescript',
}

let highlighter: Promise<Highlighter> | null = null

export async function highlight(code: string, lang: string | undefined): Promise<string> {
  highlighter ??= createHighlighter({ themes: ['github-light', 'github-dark'], langs: [...LANGS] })
  const resolved = ALIASES[lang ?? ''] ?? lang ?? 'text'
  const known = (LANGS as readonly string[]).includes(resolved) ? resolved : 'text'
  return (await highlighter).codeToHtml(code.replace(/\n$/, ''), {
    lang: known,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  })
}

// --- A tiny remark plugin: callouts and command explanations ---------------------------------

type Node = { type: string; value?: string; children?: Node[]; data?: Record<string, unknown> }

const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/

// `> [!WARNING] ...` (GitHub alert syntax) becomes <aside class="callout" data-kind="warning">.
// `> **What it does:** ...` becomes <div class="explain">, the What / Why / Expected panel.
export function remarkWorkshop() {
  return (tree: Node) => {
    const visit = (node: Node) => {
      if (node.type === 'blockquote') {
        const first = node.children?.[0]
        const firstChild = first?.children?.[0]
        if (first?.type === 'paragraph' && firstChild?.type === 'text') {
          const match = firstChild.value?.match(CALLOUT)
          if (match) {
            firstChild.value = firstChild.value!.slice(match[0].length)
            if (!firstChild.value) first.children!.shift()
            const kind = match[1].toLowerCase()
            node.data = { hName: 'aside', hProperties: { className: ['callout'], 'data-kind': kind } }
          }
        }
        if (first?.type === 'paragraph' && firstChild?.type === 'strong') {
          const label = firstChild.children?.[0]?.value ?? ''
          if (label.startsWith('What it does')) {
            node.data = { hName: 'div', hProperties: { className: ['explain'] } }
          }
        }
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}
