import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BuiltinDomainNotFoundError } from '../errors'

export type BuiltinDomainName = 'distribution'

export type BuiltinDomainPaths = {
  specPath: string
  keyPath: string
  source: 'env' | 'npm' | 'monorepo'
}

const BUILTIN_DOMAINS: BuiltinDomainName[] = ['distribution']

export function isBuiltinDomainName(value: string): value is BuiltinDomainName {
  return (BUILTIN_DOMAINS as string[]).includes(value)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the spec.json + private key for a builtin domain.
 *
 * Lookup order:
 *   1. `ASTRALE_<NAME>_SPEC` / `ASTRALE_<NAME>_KEY` env vars
 *   2. `@astrale-os/<name>-domain` npm dep exporting the spec.json
 *   3. Monorepo dev fallback: `kernel/domains/<name>/{spec.json,private-key.json}`
 */
export async function resolveBuiltinDomain(name: BuiltinDomainName): Promise<BuiltinDomainPaths> {
  const upper = name.toUpperCase()
  const envSpec = process.env[`ASTRALE_${upper}_SPEC`]
  const envKey = process.env[`ASTRALE_${upper}_KEY`]
  if (envSpec && envKey && (await exists(envSpec)) && (await exists(envKey))) {
    return { specPath: resolve(envSpec), keyPath: resolve(envKey), source: 'env' }
  }

  const pkgName = `@astrale-os/${name}-domain`
  try {
    const require = createRequire(import.meta.url)
    const specPath = require.resolve(`${pkgName}/spec.json`)
    const keyPath = require.resolve(`${pkgName}/private-key.json`)
    if ((await exists(specPath)) && (await exists(keyPath))) {
      return { specPath, keyPath, source: 'npm' }
    }
  } catch {
    /* fall through */
  }

  const here = dirname(fileURLToPath(import.meta.url))
  const monorepoRoot = resolve(here, '..', '..', '..', '..')
  const monorepoSpec = join(monorepoRoot, 'kernel', 'domains', name, 'spec.json')
  const monorepoKey = join(monorepoRoot, 'kernel', 'domains', name, 'private-key.json')
  if ((await exists(monorepoSpec)) && (await exists(monorepoKey))) {
    return { specPath: monorepoSpec, keyPath: monorepoKey, source: 'monorepo' }
  }

  throw new BuiltinDomainNotFoundError(name)
}
