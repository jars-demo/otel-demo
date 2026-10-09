import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ChapterPager } from '@/components/ChapterPager'
import { Markdown } from '@/components/Markdown'
import { CompleteButton } from '@/components/WorkshopProgress'
import { CHAPTERS, chapterIndex } from '@/lib/chapters'
import { loadChapter } from '@/lib/markdown'
import { REPO_URL } from '@/lib/site'

export const dynamicParams = false

export function generateStaticParams() {
  return CHAPTERS.map((chapter) => ({ slug: chapter.slug }))
}

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const chapter = CHAPTERS[chapterIndex(slug)]
  if (!chapter) return {}
  return {
    title: `${chapter.number} · ${chapter.title}`,
    description: chapter.summary,
    alternates: { canonical: `/workshop/${slug}/` },
  }
}

export default async function ChapterPage({ params }: Props) {
  const { slug } = await params
  const index = chapterIndex(slug)
  if (index === -1) notFound()
  const chapter = CHAPTERS[index]
  const previous = CHAPTERS[index - 1]
  const next = CHAPTERS[index + 1]
  const { meta, body } = await loadChapter(slug)

  return (
    <article>
      <header className="border-b border-line pb-6">
        <div className="flex items-center justify-between gap-4">
          <p className="font-mono text-sm font-semibold text-accent">Chapter {chapter.number}</p>
          <ChapterPager previous={previous} next={next} index={index} total={CHAPTERS.length} compact />
        </div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{chapter.title}</h1>
        {meta && <p className="mt-3 text-muted">⏱ {meta}</p>}
      </header>

      <div className="mt-8">
        <Markdown source={body} />
      </div>

      <footer className="mt-12 space-y-6 border-t border-line pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CompleteButton slug={slug} />
          <a
            className="text-sm text-muted underline-offset-4 hover:underline"
            href={`${REPO_URL}/blob/main/workshop/${slug}.md`}
            target="_blank"
            rel="noreferrer"
          >
            Edit this chapter on GitHub
          </a>
        </div>
        <ChapterPager previous={previous} next={next} index={index} total={CHAPTERS.length} />
      </footer>
    </article>
  )
}
