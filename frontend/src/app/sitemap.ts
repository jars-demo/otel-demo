import type { MetadataRoute } from 'next'

import { CHAPTERS } from '@/lib/chapters'
import { loadIncidents } from '@/lib/incidents'
import { MORE_NAV, NAV, SITE_URL } from '@/lib/site'

export const dynamic = 'force-static'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = [...NAV, ...MORE_NAV].map((item) => item.href)
  const chapters = CHAPTERS.map((chapter) => `/workshop/${chapter.slug}/`)
  const incidents = (await loadIncidents()).map((incident) => `/incidents/${incident.slug}/`)
  return [...pages, ...chapters, ...incidents].map((path) => ({ url: `${SITE_URL}${path}` }))
}
