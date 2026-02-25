import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { log } from '../lib/logger'

export interface LoadedDistribution {
  config: { name: string; version?: string; schema: unknown; [key: string]: unknown }
}

/**
 * Dynamically import and validate the distribution entry file.
 * Throws if the file is missing or the export is invalid.
 */
export async function loadDistribution(entryPath: string): Promise<LoadedDistribution> {
  const resolved = resolve(entryPath)
  if (!existsSync(resolved)) {
    throw new Error(
      `Distribution entry not found: ${entryPath}\n` +
        'Create src/distribution.ts with a default export from defineDistribution().',
    )
  }

  log.info('Loading distribution...')
  const mod = await import(resolved)
  const dist = mod.default
  if (!dist || !dist.name) {
    throw new Error(
      `No valid distribution found at ${entryPath}.\n` +
        'Expected a default export from defineDistribution().',
    )
  }

  return { config: dist }
}
