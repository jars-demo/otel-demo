import type { Metadata } from 'next'

import { CodeBlock } from '@/components/CodeBlock'
import { CHAPTERS, TOTAL_MINUTES } from '@/lib/chapters'
import { REPO_URL } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Workshop',
  description:
    'Sixteen hands-on chapters: run a small distributed system, instrument it with OpenTelemetry, build the telemetry pipeline, then break it and find the root cause.',
  alternates: { canonical: '/workshop/' },
}

export default function WorkshopIndex() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Workshop</h1>
      <p className="mt-2 text-muted">
        {CHAPTERS.length} chapters · about {Math.round(TOTAL_MINUTES / 60)} hours · every command says what it does,
        why, and what you should see.
      </p>

      <h2 className="mt-8 text-sm font-medium text-muted">
        You need Git and Docker (with Compose). uv is optional, for the tests.
      </h2>
      <div className="mt-2">
        <CodeBlock lang="bash" code={`git clone ${REPO_URL}.git\ncd otel-demo\ndocker compose up -d --build --wait`} />
      </div>

      <ol className="mt-8 divide-y divide-line rounded-xl border border-line bg-paper">
        {CHAPTERS.map((chapter) => (
          <li key={chapter.slug}>
            <a href={`/workshop/${chapter.slug}/`} className="flex items-center gap-4 px-4 py-3 hover:bg-paper-2">
              <span className="w-6 font-mono text-xs text-faint">{chapter.number}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{chapter.title}</span>
                <span className="block truncate text-sm text-muted">{chapter.summary}</span>
              </span>
              <span className="font-mono text-xs text-faint">{chapter.minutes}m</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  )
}
