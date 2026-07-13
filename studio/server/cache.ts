/**
 * cache.ts — in-memory per-domain caches for the (relatively expensive) bundle
 * and anatomy, so API reads and the file-watcher share one computed value.
 * Watchers invalidate on change; the next read rebuilds and re-broadcasts.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import type { DomainAnatomy, StudioCore, StudioSchemaBundle } from '../shared/types'

import { invalidateClientPackage, resolveClientPackage } from './client-package'
import { getDomain } from './domain'
import { buildAnatomy } from './introspect/anatomy'
import { buildBundle } from './introspect/bundle'
import { buildCore } from './introspect/core'
import { hashAnatomyFiles } from './state/baseline'
import { readJson, writeJson } from './state/store'

const bundles = new Map<string, StudioSchemaBundle>()
const anatomies = new Map<string, Promise<DomainAnatomy>>()
const cores = new Map<string, StudioCore>()

const BUNDLE_CACHE_FILE = '.cache/schema-bundle.json'
const BUNDLE_CACHE_VERSION = 2
const LOCKFILES = ['bun.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']
const TOOL_INPUTS = [
  'cache.ts',
  'introspect/bundle.ts',
  'introspect/runtime.ts',
  'introspect/extractor.ts',
  'introspect/overlay.ts',
  'introspect/overlay-tsmorph.ts',
  'introspect/hash.ts',
  'state/baseline.ts',
  '../shared/types.ts',
]

interface BundleCacheEntry {
  version: number
  key: string
  bundle: StudioSchemaBundle
}

function hashFileIfPresent(hash: ReturnType<typeof createHash>, label: string, file: string): void {
  try {
    if (!existsSync(file)) return
    hash.update(`${label}\0`)
    hash.update(readFileSync(file))
    hash.update('\0')
  } catch {
    hash.update(`${label}\0unreadable\0`)
  }
}

function bundleCacheKey(root: string, schemaDirName: string): string {
  const hash = createHash('sha256')
  hash.update(`domain-studio-bundle-cache-v${BUNDLE_CACHE_VERSION}\0`)
  hash.update(`schema-dir:${schemaDirName}\0`)
  hash.update(`bun:${Bun.version}\0`)

  const files = hashAnatomyFiles(root, schemaDirName)
  for (const [file, digest] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(`${file}\0${digest}\0`)
  }
  for (const file of LOCKFILES) hashFileIfPresent(hash, file, join(root, file))

  const serverRoot = import.meta.dir
  for (const file of TOOL_INPUTS) {
    const abs = join(serverRoot, file)
    hashFileIfPresent(hash, `tool:${relative(serverRoot, abs)}`, abs)
  }

  return hash.digest('hex')
}

function readCachedBundle(root: string, key: string): StudioSchemaBundle | null {
  const entry = readJson<BundleCacheEntry | null>(root, BUNDLE_CACHE_FILE, null)
  if (!entry || entry.version !== BUNDLE_CACHE_VERSION || entry.key !== key || !entry.bundle)
    return null
  return entry.bundle
}

function writeCachedBundle(root: string, key: string, bundle: StudioSchemaBundle): void {
  try {
    writeJson(root, BUNDLE_CACHE_FILE, {
      version: BUNDLE_CACHE_VERSION,
      key,
      bundle,
    } satisfies BundleCacheEntry)
  } catch {
    // Cache writes must never make schema rendering fail.
  }
}

export async function getBundle(id: string, rebuild = false): Promise<StudioSchemaBundle | null> {
  const h = getDomain(id)
  if (!h) return null
  if (!rebuild && bundles.has(id)) return bundles.get(id)!
  const keyBefore = bundleCacheKey(h.root, h.schemaDirName)
  if (!rebuild) {
    const cached = readCachedBundle(h.root, keyBefore)
    if (cached) {
      if (cached.ir) h.origin = cached.ir.domain
      bundles.set(id, cached)
      return cached
    }
  }
  const b = await buildBundle(h)
  bundles.set(id, b)
  const keyAfter = bundleCacheKey(h.root, h.schemaDirName)
  if (keyAfter === keyBefore) writeCachedBundle(h.root, keyAfter, b)
  return b
}

export async function getAnatomy(id: string, rebuild = false): Promise<DomainAnatomy | null> {
  const h = getDomain(id)
  if (!h) return null
  if (!rebuild && anatomies.has(id)) return anatomies.get(id)!
  const anatomy = resolveClientPackage(h.root, rebuild).then((client) =>
    buildAnatomy({
      root: h.root,
      schemaDirName: h.schemaDirName,
      clientDir: client.status === 'available' ? client.dir : undefined,
    }),
  )
  anatomies.set(id, anatomy)
  return anatomy
}

export async function getCore(id: string, rebuild = false): Promise<StudioCore | null> {
  const h = getDomain(id)
  if (!h) return null
  if (!rebuild && cores.has(id)) return cores.get(id)!
  const c = await buildCore(h)
  cores.set(id, c)
  return c
}

export function invalidate(id: string, what: 'schema' | 'anatomy' | 'all'): void {
  if (what !== 'anatomy') bundles.delete(id)
  if (what !== 'schema') {
    anatomies.delete(id)
    const domain = getDomain(id)
    if (domain) invalidateClientPackage(domain.root)
  }
  // Core is derived from domain.ts (in the anatomy fileset), so it tracks anatomy.
  if (what !== 'schema') cores.delete(id)
}
