/**
 * Runs one versions-island request in a short-lived extractor process, the way the Schema itself
 * is extracted: from a neutral directory, under a hard deadline. The request travels as a file,
 * since a Schema closure is far larger than an argument list may be.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { IslandRequest } from './island'

import { runExtractorIsland } from '../../introspect/runtime'
import { VERSIONS_MODE } from './island'

const EXTRACTOR = new URL('../../introspect/extractor.ts', import.meta.url).pathname

/** The island's JSON answer. Throws when it could not run or answered nothing readable. */
export async function runIsland(request: IslandRequest, timeoutMs: number): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), 'astrale-studio-versions-'))
  try {
    const file = join(directory, 'request.json')
    await writeFile(file, JSON.stringify(request))
    const { stdout, stderr } = await runExtractorIsland(
      '__studio-extractor',
      EXTRACTOR,
      [VERSIONS_MODE, file],
      timeoutMs,
    )
    if (!stdout.trim()) throw new Error(stderr.trim() || 'The versions island produced no output.')
    return JSON.parse(stdout)
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}
