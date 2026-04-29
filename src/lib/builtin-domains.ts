import { access, readdir, readFile } from 'node:fs/promises'
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
 * Locate a worker private-key JWK under `<specDir>/worker/keys/`.
 *
 * Mirrors the CLI's `instance install` auto-detection: prefers
 * `${baseDomain}-worker.jwk.json` (read from spec meta), otherwise the
 * single `*.jwk.json` if there is exactly one.
 */
async function resolveWorkerKey(specPath: string): Promise<string | null> {
  const keysDir = join(dirname(specPath), 'worker', 'keys')
  let entries: string[]
  try {
    entries = await readdir(keysDir)
  } catch {
    return null
  }
  const jwks = entries.filter((n) => n.endsWith('.jwk.json'))
  if (jwks.length === 0) return null

  let baseDomain: string | undefined
  try {
    const raw = await readFile(specPath, 'utf-8')
    const meta = (JSON.parse(raw) as { meta?: { baseDomain?: unknown } }).meta
    if (meta && typeof meta.baseDomain === 'string') baseDomain = meta.baseDomain
  } catch {
    /* fall through */
  }

  if (baseDomain) {
    const exact = `${baseDomain}-worker.jwk.json`
    if (jwks.includes(exact)) return join(keysDir, exact)
  }
  if (jwks.length === 1) return join(keysDir, jwks[0]!)
  return null
}

/**
 * Resolve the spec.json + private key for a builtin domain.
 *
 * Lookup order:
 *   1. `ASTRALE_<NAME>_SPEC` / `ASTRALE_<NAME>_KEY` env vars
 *   2. `@astrale-os/<name>-domain` npm dep exporting the spec.json
 *      (key auto-detected under the package's `worker/keys/`)
 *   3. Monorepo dev fallback: `<workspace>/domains/<name>/spec.json`
 *      (key auto-detected under `<workspace>/domains/<name>/worker/keys/`)
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
    if (await exists(specPath)) {
      const keyPath = await resolveWorkerKey(specPath)
      if (keyPath) return { specPath, keyPath, source: 'npm' }
    }
  } catch {
    /* fall through */
  }

  // CLI source layout: cli/src/lib/builtin-domains.ts → 3 levels up = workspace root.
  const here = dirname(fileURLToPath(import.meta.url))
  const workspaceRoot = resolve(here, '..', '..', '..')
  const monorepoSpec = join(workspaceRoot, 'domains', name, 'spec.json')
  if (await exists(monorepoSpec)) {
    const monorepoKey = await resolveWorkerKey(monorepoSpec)
    if (monorepoKey) {
      return { specPath: monorepoSpec, keyPath: monorepoKey, source: 'monorepo' }
    }
  }

  throw new BuiltinDomainNotFoundError(name)
}
