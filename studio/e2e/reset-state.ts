/**
 * Start every run from the same fixture.
 *
 * The specs drag nodes, shut groups, pin comment threads and write Scenarios, and each of those
 * persists under the domain's `.domain-studio/`. Left in place, the next run
 * begins where the last one ended — a drag with nowhere left to move to, a group
 * already shut — and reds specs that have nothing wrong with them. Only
 * what the suite itself writes is cleared: `.cache/` holds the schema extraction,
 * which is expensive, is derived from the sources, and nothing here invalidates.
 */
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { REGISTRY_DIR } from './registry'

const FIXTURE = fileURLToPath(new URL('./fixture/', import.meta.url))
const STUDIO = fileURLToPath(new URL('../', import.meta.url))
const TEST_ASTRALE_HOME = join(STUDIO, 'test-results', 'astrale-home')
const WRITTEN_BY_THE_SUITE = [
  'layout.json',
  'comments.json',
  'scenarios.json',
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
  // Chats and workspace UI now live in the machine home. The E2E server points this
  // explicit test-only directory at ASTRALE_HOME, so clearing it cannot touch user data.
  await rm(TEST_ASTRALE_HOME, { force: true, recursive: true })
  // what a spec left the stubbed registry serving, had it no chance to clear it
  await rm(REGISTRY_DIR, { force: true, recursive: true })
  // the workspace fixture and the peer domain it imports
  await resetDomainState(FIXTURE)
  await resetDomainState(join(FIXTURE, 'peer'))
}
