import { existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import type { AstraleConfig } from '../types'

const CONFIG_FILES = ['astrale.config.ts', 'astrale.config.js', 'astrale.config.mjs']

const DEFAULTS: Required<AstraleConfig> = {
  preset: 'falkordb',
  graphName: basename(process.cwd()),
  host: 'localhost',
  port: 6379,
  schema: './schema/main.gsl',
  outputDir: './schema',
  entry: './src/distribution.ts',
  wsPort: 3001,
  issuer: 'https://local.kernel',
}

export type ResolvedConfig = Required<AstraleConfig>

export async function loadConfig(cwd: string = process.cwd()): Promise<ResolvedConfig> {
  for (const file of CONFIG_FILES) {
    const path = resolve(cwd, file)
    if (!existsSync(path)) continue

    // File exists — import it; let errors propagate (syntax errors, bad imports, etc.)
    const mod = await import(path)
    const raw: AstraleConfig = mod.default ?? mod
    return { ...DEFAULTS, ...raw }
  }

  throw new Error(
    `No astrale.config.ts found in ${cwd}.\nRun "astrale create <name>" to get started.`,
  )
}
