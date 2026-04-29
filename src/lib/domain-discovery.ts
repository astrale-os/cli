/**
 * Domain discovery: resolve the "current domain" from a cwd, read its
 * package.json + optional `lifecycle.ts`, derive its slug.
 *
 * A "domain directory" is any dir containing both `package.json` and
 * `envs.ts`. We walk up from `cwd` (bounded) to find one.
 */

import type { LifecycleModule } from '@astrale-os/kernel-host'

import { existsSync, readFileSync } from 'node:fs'
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
 * Walk up from `cwd` (or the optional override) until we find a dir
 * that looks like a domain. Maximum 6 levels up before giving up.
 */
export async function resolveDomainDir(cwdOverride?: string): Promise<ResolvedDomain> {
  const start = cwdOverride
    ? isAbsolute(cwdOverride)
      ? cwdOverride
      : resolve(process.cwd(), cwdOverride)
    : process.cwd()

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

function findDomainDir(start: string, maxHops = 6): string | null {
  let dir = start
  for (let i = 0; i <= maxHops; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'envs.ts'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
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
