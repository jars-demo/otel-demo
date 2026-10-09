import type { ComponentProps, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { remarkWorkshop } from '@/lib/markdown'
import { REPO_URL, SITE_URL } from '@/lib/site'

import { CodeBlock } from './CodeBlock'

type HastNode = {
  type: string
  value?: string
  tagName?: string
  properties?: { className?: string[] }
  children?: HastNode[]
}

function textOf(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

function plain(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(plain).join('')
  if (children && typeof children === 'object' && 'props' in children) {
    return plain((children.props as { children?: ReactNode }).children)
  }
  return ''
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

// Chapter links (`05-logs.md`) go to the chapter page; repository paths (`../infra/otel`) go to
// GitHub; links to the live site stay on the site.
export function rewriteHref(href: string): { href: string; external: boolean } {
  const chapter = href.match(/^(\d\d-[a-z0-9-]+)\.md(#.*)?$/)
  if (chapter) return { href: `/workshop/${chapter[1]}/${chapter[2] ?? ''}`, external: false }
  if (href.startsWith('../')) return { href: `${REPO_URL}/blob/main/${href.slice(3)}`, external: true }
  if (href.startsWith(SITE_URL)) return { href: href.slice(SITE_URL.length) || '/', external: false }
  if (/^https?:\/\//.test(href)) return { href, external: true }
  return { href, external: false }
}

function Anchor({ href = '', children }: ComponentProps<'a'>) {
  const link = rewriteHref(href)
  return link.external ? (
    <a href={link.href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <a href={link.href}>{children}</a>
  )
}

function Pre({ node }: { node?: HastNode }) {
  const code = node?.children?.find((child) => child.tagName === 'code')
  const lang = code?.properties?.className?.find((c) => c.startsWith('language-'))?.slice(9)
  return <CodeBlock code={textOf(code)} lang={lang} />
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="prose-workshop">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkWorkshop]}
        components={{
          pre: Pre as never,
          a: Anchor,
          table: ({ children }) => (
            <div className="table-wrap">
              <table>{children}</table>
            </div>
          ),
          h2: ({ children }) => <h2 id={slugify(plain(children))}>{children}</h2>,
          h3: ({ children }) => <h3 id={slugify(plain(children))}>{children}</h3>,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
