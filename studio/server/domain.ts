/**
 * domain.ts — DomainHandle resolution + the in-process registry. A "domain" is
 * confirmed by the triple: astrale.config.ts + domain.ts + <schemaDir>/index.ts.
 * The schema dir is configurable (default 'schema') and threaded everywhere.
 */
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

export interface DomainHandle {
  id: string
  root: string
  configFile: string
  domainFile: string
  schemaDirName: string
  schemaDir: string
  schemaIndex: string
  origin?: string
}

const registry = new Map<string, DomainHandle>()

export function makeId(root: string): string {
  return basename(resolve(root)).replace(/[^a-zA-Z0-9_-]/g, '-') || 'domain'
}

/** The single definition of "is this dir an Astrale domain": the triple must all exist. */
export function isDomainDir(root: string, schemaDirName = 'schema'): boolean {
  const r = resolve(root)
  return (
    existsSync(join(r, 'astrale.config.ts')) &&
    existsSync(join(r, 'domain.ts')) &&
    existsSync(join(r, schemaDirName, 'index.ts'))
  )
}

/** Confirm + register a domain rooted at `root`. Returns null if the triple is incomplete. */
export function registerDomain(root: string, schemaDirName = 'schema'): DomainHandle | null {
  const r = resolve(root)
  if (!isDomainDir(r, schemaDirName)) return null
  const schemaDir = join(r, schemaDirName)
  const handle: DomainHandle = {
    id: makeId(r),
    root: r,
    configFile: join(r, 'astrale.config.ts'),
    domainFile: join(r, 'domain.ts'),
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

/** Does the domain have @astrale-os deps installed (precondition for runtime introspection)? */
export function depsInstalled(root: string): boolean {
  return existsSync(join(root, 'node_modules', '@astrale-os', 'kernel-core'))
}
