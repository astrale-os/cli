/**
 * domain.ts — DomainHandle resolution + the in-process registry. A "domain" is
 * confirmed by astrale.config.ts + a composition entry + <schemaDir>/index.ts.
 * Current SDK projects use implementation.ts; domain.ts remains the legacy
 * fallback. The schema dir is configurable (default 'schema') and threaded
 * everywhere.
 */
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

export interface DomainHandle {
  id: string
  root: string
  configFile: string
  /** Active composition entry (implementation.ts when present, otherwise legacy domain.ts). */
  domainFile: string
  schemaDirName: string
  schemaDir: string
  schemaIndex: string
  origin?: string
}

const registry = new Map<string, DomainHandle>()

export const DOMAIN_ENTRY_FILES = ['implementation.ts', 'domain.ts'] as const

export function makeId(root: string): string {
  return basename(resolve(root)).replace(/[^a-zA-Z0-9_-]/g, '-') || 'domain'
}

/** Resolve the current composition entry, preferring the SDK layout. */
export function resolveDomainEntry(root: string): string | null {
  const r = resolve(root)
  for (const file of DOMAIN_ENTRY_FILES) {
    const candidate = join(r, file)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** The single definition of "is this dir an Astrale domain": the triple must all exist. */
export function isDomainDir(root: string, schemaDirName = 'schema'): boolean {
  const r = resolve(root)
  return (
    existsSync(join(r, 'astrale.config.ts')) &&
    resolveDomainEntry(r) !== null &&
    existsSync(join(r, schemaDirName, 'index.ts'))
  )
}

/** Confirm + register a domain rooted at `root`. Returns null if the triple is incomplete. */
export function registerDomain(root: string, schemaDirName = 'schema'): DomainHandle | null {
  const r = resolve(root)
  if (!isDomainDir(r, schemaDirName)) return null
  const domainFile = resolveDomainEntry(r)
  if (!domainFile) return null
  const schemaDir = join(r, schemaDirName)
  const handle: DomainHandle = {
    id: makeId(r),
    root: r,
    configFile: join(r, 'astrale.config.ts'),
    domainFile,
    schemaDirName,
    schemaDir,
    schemaIndex: join(schemaDir, 'index.ts'),
  }
  registry.set(handle.id, handle)
  return handle
}

/** Drop a domain from the registry (its dir/triple is gone). */
export function unregisterDomain(id: string): void {
  registry.delete(id)
}

export function getDomain(id: string): DomainHandle | undefined {
  return registry.get(id)
}

export function allDomains(): DomainHandle[] {
  return [...registry.values()]
}

/** Does the domain have the dependency cohort required by its project layout installed? */
export function depsInstalled(root: string): boolean {
  const installed = (packageDir: string, specifier: string): boolean => {
    if (existsSync(join(root, 'node_modules', '@astrale-os', packageDir))) return true
    try {
      Bun.resolveSync(specifier, root)
      return true
    } catch {
      return false
    }
  }

  // A workspace may hoist the package above the Domain root. Check both the
  // conventional local link and Bun's real resolver from the Domain boundary.
  const sdk = installed('sdk', '@astrale-os/sdk/schema')
  const entry = resolveDomainEntry(root)

  // implementation.ts is an SDK boundary by contract. Legacy domain.ts
  // projects may predate the SDK facade and depend on kernel-core directly.
  if (entry?.endsWith('implementation.ts')) return sdk
  return sdk || installed('kernel-core', '@astrale-os/kernel-core')
}
