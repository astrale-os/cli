/**
 * Start every run from the same fixture.
 *
 * The specs drag nodes, hide an imported domain and pin comment threads, and each
 * of those persists under the domain's `.domain-studio/`. Left in place, the next
 * run begins where the last one ended — a drag with nowhere left to move to, a
 * domain already hidden — and reds specs that have nothing wrong with them. Only
 * what the suite itself writes is cleared: `.cache/` holds the schema extraction,
 * which is expensive, is derived from the sources, and nothing here invalidates.
 */
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE = fileURLToPath(new URL('./fixture/', import.meta.url))
const WRITTEN_BY_THE_SUITE = [
  'layout.json',
  'visibility.json',
  'comments.json',
  // uploaded documents and the index that lists them
  'context',
]

async function resetDomainState(dir: string): Promise<void> {
  const state = join(dir, '.domain-studio')
  const present = await readdir(state).catch(() => null)
  if (!present) return
  await Promise.all(
    WRITTEN_BY_THE_SUITE.map((entry) => rm(join(state, entry), { force: true, recursive: true })),
  )
}

export default async function resetFixtureState(): Promise<void> {
  // the workspace fixture and the peer domain it imports
  await resetDomainState(FIXTURE)
  await resetDomainState(join(FIXTURE, 'peer'))
}
