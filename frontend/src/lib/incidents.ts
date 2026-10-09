// Server-only: reads incidents/*/incident.yaml at build time. The same files drive the
// lab-console, so the website and the running lab can never disagree about an incident.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'yaml'

import { REPO_ROOT } from './markdown'
import type { Incident } from './types'

export async function loadIncidents(): Promise<Incident[]> {
  const dir = path.join(REPO_ROOT, 'incidents')
  const folders = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory())
  const incidents = await Promise.all(
    folders.map(async (folder) => {
      const raw = await readFile(path.join(dir, folder.name, 'incident.yaml'), 'utf8')
      return parse(raw) as Incident
    }),
  )
  return incidents.sort((a, b) => a.id.localeCompare(b.id))
}

export async function loadIncident(slug: string): Promise<Incident | undefined> {
  return (await loadIncidents()).find((incident) => incident.slug === slug)
}
