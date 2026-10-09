import type { ReactNode } from 'react'

import { WorkshopSidebar } from './WorkshopSidebar'

export default function WorkshopLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:py-12">
      <WorkshopSidebar />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
