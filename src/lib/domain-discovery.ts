/**
 * Domain discovery: resolve the "current domain" from a cwd, read its
 * package.json + optional `lifecycle.ts`, derive its slug.
 *
 * A "domain directory" is any dir containing both `package.json` and
 * `envs.ts`. We walk up from `cwd` (bounded) to find one.
 */

import type { LifecycleModule } from '@astrale-os/kernel-host'

import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { AstraleError } from '../errors'

export type DomainPackageJson = {
  name?: string
  scripts?: Record<string, string>
  [key: string]: unknown
}

export type ResolvedDomain = {
  /** Absolute path to the domain directory. */
  dir: string
  /** Slug derived from `package.json` name (`@astrale-os/<slug>-domain` → `<slug>`). */
  slug: string
  /** Parsed package.json. */
  pkg: DomainPackageJson
  /**
   * Loaded `lifecycle.ts` module if the domain ships one. Looked up at
   * `<dir>/lifecycle.ts` then `<dir>/scripts/lifecycle.ts`. `undefined`
   * if absent.
   */
  lifecycle?: LifecycleModule
  /** Absolute path to the lifecycle module that was loaded, if any. */
  lifecyclePath?: string
}

/**
 * Resolve an optional `cwdOverride` to an absolute starting directory.
 * Falls back to `process.cwd()` when no override is given; a relative
 * override is resolved against `process.cwd()`. An already-absolute path
 * is returned unchanged.
 */
function resolveStart(cwdOverride?: string): string {
  if (!cwdOverride) return process.cwd()
  return isAbsolute(cwdOverride) ? cwdOverride : resolve(process.cwd(), cwdOverride)
}

/**
 * Walk up from `cwd` (or the optional override) until we find a dir
 * that looks like a domain. Maximum 6 levels up before giving up.
 */
export async function resolveDomainDir(cwdOverride?: string): Promise<ResolvedDomain> {
  const start = resolveStart(cwdOverride)

  const dir = findDomainDir(start)
  if (!dir) {
    throw new AstraleError(
      'NOT_IN_DOMAIN',
      `Not inside a domain directory (searched upward from ${start})`,
      'Run from inside a domain folder (must contain package.json + envs.ts), or pass --cwd <path>.',
    )
  }

  const pkgPath = join(dir, 'package.json')
  let pkg: DomainPackageJson
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as DomainPackageJson
  } catch (e) {
    throw new AstraleError(
      'BAD_PACKAGE_JSON',
      `Failed to parse ${pkgPath}: ${(e as Error).message}`,
    )
  }

  const slug = deriveSlug(pkg.name ?? '')
  if (!slug) {
    throw new AstraleError(
      'NO_SLUG',
      `Cannot derive slug from package.json name "${pkg.name ?? '(unset)'}"`,
      'Expected a name like `@astrale-os/<slug>-domain` or a plain `<slug>`.',
    )
  }

  const { module, path } = await tryLoadLifecycle(dir)
  return { dir, slug, pkg, lifecycle: module, lifecyclePath: path }
}

/**
 * Resolve every domain directory the `dev` commands should act on.
 *
 * Primary strategy: a recursive scan *down* from the cwd (or the
 * `--cwd` override) — every domain found under it. This is what makes
 * `astrale domain dev up` from a parent folder bring up the whole tree.
 *
 * Fallback: if nothing is found below, fall back to the legacy walk-*up*
 * single-domain resolver so running from inside a domain (or one of its
 * subfolders) still works. `resolveDomainDir` throws
 * `AstraleError('NOT_IN_DOMAIN', …)` (with its hint) when neither
 * strategy finds anything.
 */
export async function resolveDomainDirs(cwdOverride?: string): Promise<string[]> {
  const start = resolveStart(cwdOverride)

  const found = await findDomainDirsUnder(start)
  if (found.length > 0) return found

  const resolved = await resolveDomainDir(start)
  return [resolved.dir]
}

/**
 * Derive a kebab-case slug from a package.json `name`. Mirrors the
 * pattern used by the scaffold (`cli/src/lib/domain-scaffold.ts`) and
 * the template's `scripts/lib.ts#domainSlug`.
 */
export function deriveSlug(pkgName: string): string {
  return pkgName
    .replace(/^@astrale-os\//, '')
    .replace(/-domain$/, '')
    .trim()
}

/** A domain directory is any dir containing BOTH `package.json` and `envs.ts`. */
function isDomainDir(dir: string): boolean {
  return existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'envs.ts'))
}

function findDomainDir(start: string, maxHops = 6): string | null {
  let dir = start
  for (let i = 0; i <= maxHops; i++) {
    if (isDomainDir(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/**
 * Directory basenames the recursive scan never descends into. Skips
 * dependency/build dirs (perf, no false positives) and `templates` so
 * the CLI's own template domain isn't brought up when the scan starts
 * from the workspace root.
 */
const DEFAULT_DISCOVERY_EXCLUDES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.wrangler',
  'templates',
]

export type FindDomainDirsOpts = {
  /** Max directory depth to descend from the root (root itself = depth 0). Default 5. */
  maxDepth?: number
  /** Directory basenames to never descend into. Defaults to {@link DEFAULT_DISCOVERY_EXCLUDES}. */
  excludeDirs?: string[]
}

/**
 * Recursively scan *down* from `root` for domain directories. Domains
 * are never nested in one another, so descent stops as soon as a domain
 * root matches. Excluded directory basenames are skipped; the scan is
 * bounded by `maxDepth`. Symlinked directories are not followed — with
 * `withFileTypes`, `entry.isDirectory()` is `false` for a symlink, so
 * loops are structurally impossible (no visited-set needed). Unreadable
 * directories are skipped silently. Returns absolute paths, deduped and
 * sorted.
 */
export async function findDomainDirsUnder(
  root: string,
  opts: FindDomainDirsOpts = {},
): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? 5
  const excludes = new Set(opts.excludeDirs ?? DEFAULT_DISCOVERY_EXCLUDES)
  const found: string[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (isDomainDir(dir)) {
      found.push(dir)
      return // domains are not nested — stop descending
    }
    if (depth >= maxDepth) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable directory — skip this subtree
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue // skips files AND symlinks (no loop risk)
      if (excludes.has(entry.name)) continue
      await walk(join(dir, entry.name), depth + 1)
    }
  }

  await walk(resolve(root), 0)
  return [...new Set(found)].sort()
}

async function tryLoadLifecycle(dir: string): Promise<{ module?: LifecycleModule; path?: string }> {
  const candidates = [join(dir, 'lifecycle.ts'), join(dir, 'scripts', 'lifecycle.ts')]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const mod = (await import(pathToFileURL(path).href)) as LifecycleModule
      return { module: mod, path }
    } catch (e) {
      throw new AstraleError(
        'LIFECYCLE_LOAD_FAILED',
        `Failed to load lifecycle module ${path}: ${(e as Error).message}`,
        'Fix the export errors, or delete the file to fall back to zero-config.',
      )
    }
  }
  return {}
}
