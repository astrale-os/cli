/**
 * detect.ts — workspace domain detection. Walks a directory tree (symlink-safe,
 * ignoring node_modules/.git/.astrale/dist/…), registering every confirmed
 * domain whose Application selects an authored Schema. Also handles being pointed
 * at a single astrale.config.ts.
 */
import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { type DomainHandle, registerDomain } from './domain'

const IGNORE = new Set([
  'node_modules',
  '.git',
  '.astrale',
  'dist',
  '.dist',
  '.domain-studio',
  '.next',
  '.cache',
  '.turbo',
  '.vercel',
  'coverage',
])

/** Resolve a CLI target: a path to astrale.config.ts, a domain dir, or a workspace to scan. */
export function resolveTarget(target: string): DomainHandle[] {
  const abs = resolve(target)
  if (abs.endsWith('astrale.config.ts')) {
    const h = registerDomain(dirname(abs))
    return h ? [h] : []
  }
  // a single domain dir?
  const single = registerDomain(abs)
  if (single) {
    // still scan beneath for sibling/nested domains (e.g. a workspace whose root is also a domain)
    const nested = scanWorkspace(abs).filter((d) => d.id !== single.id)
    return dedupe([single, ...nested])
  }
  return scanWorkspace(abs)
}

export function scanWorkspace(workspace: string, maxDepth = 4): DomainHandle[] {
  const found: DomainHandle[] = []
  const root = resolve(workspace)
  if (!existsSync(root)) return found

  const walk = (dir: string, depth: number) => {
    const h = registerDomain(dir)
    if (h) found.push(h)
    if (depth >= maxDepth) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const e of entries) {
      if (IGNORE.has(e) || e.startsWith('.')) continue
      const full = join(dir, e)
      let st
      try {
        st = lstatSync(full)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) continue // never follow symlinks (pnpm farms)
      if (st.isDirectory()) walk(full, depth + 1)
    }
  }
  walk(root, 0)
  return dedupe(found)
}

function dedupe(domains: DomainHandle[]): DomainHandle[] {
  const seen = new Set<string>()
  return domains.filter((d) => (seen.has(d.root) ? false : (seen.add(d.root), true)))
}
