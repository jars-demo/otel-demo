'use client'

import { usePathname } from 'next/navigation'

import { ChapterList, ProgressBar } from '@/components/WorkshopProgress'

export function WorkshopSidebar() {
  const current = usePathname()?.split('/').filter(Boolean)[1]
  return (
    <aside
      aria-label="Workshop chapters"
      className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto"
    >
      <details className="card p-4 lg:hidden">
        <summary className="cursor-pointer text-sm font-semibold">Chapters and progress</summary>
        <div className="mt-4 space-y-4">
          <ProgressBar />
          <ChapterList current={current} />
        </div>
      </details>
      <div className="hidden space-y-5 lg:block">
        <ProgressBar />
        <ChapterList current={current} />
      </div>
    </aside>
  )
}
