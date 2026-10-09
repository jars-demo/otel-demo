import type { ReactNode } from 'react'

import { loadContent } from '@/lib/markdown'

import { Markdown, slugify } from './Markdown'
import { PageHeader } from './ui'

/** A long-form page from frontend/content/<name>.md, with a table of contents from its H2s. */
export async function ContentPage({
  name,
  eyebrow,
  title,
  intro,
  before,
}: {
  name: string
  eyebrow: string
  title: string
  intro: ReactNode
  before?: ReactNode
}) {
  const source = await loadContent(name)
  const headings = source
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim())

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow={eyebrow} title={title}>
        {intro}
      </PageHeader>
      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0 max-w-3xl">
          {before}
          <Markdown source={source} />
        </div>
        <nav aria-label="On this page" className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">On this page</p>
          <ul className="mt-3 space-y-2 border-l border-line text-sm">
            {headings.map((heading) => (
              <li key={heading}>
                <a
                  href={`#${slugify(heading)}`}
                  className="-ml-px block border-l border-transparent pl-3 text-muted hover:border-accent hover:text-text"
                >
                  {heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  )
}
