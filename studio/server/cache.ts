/**
 * cache.ts — in-memory per-domain caches for the (relatively expensive) bundle
 * and anatomy, so API reads and the file-watcher share one computed value.
 * Watchers invalidate on change; the next read rebuilds and re-broadcasts.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import type { DomainAnatomy, SchemaOverlay, StudioCore, StudioSchemaBundle } from '../shared/types'

import { isSchemaRevision } from '../shared/types'
import { invalidateClientPackage, resolveClientPackage } from './client-package'
import { getDomain } from './domain'
import { buildAnatomy } from './introspect/anatomy'
import { buildBundle } from './introspect/bundle'
import { isCanonicalDomainSchemaV1 } from './introspect/canonical-schema'
import { buildCore } from './introspect/core'
import { decodeIrInterfaceRecord, decodeSchemaIR } from './introspect/schema-ir-json'
import { asBoolean, asFiniteNumber, asJsonRecord, asString, asStringArray } from './json'
import { hashAnatomyFiles } from './state/baseline'
import { readJson, writeJson } from './state/store'

const bundles = new Map<string, StudioSchemaBundle>()
const anatomies = new Map<string, Promise<DomainAnatomy>>()
const cores = new Map<string, StudioCore>()

const BUNDLE_CACHE_FILE = '.cache/schema-bundle.json'
const BUNDLE_CACHE_VERSION = 4
const LOCKFILES = ['bun.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']
const TOOL_INPUTS = [
  'cache.ts',
  'domain.ts',
  'introspect/bundle.ts',
  'introspect/runtime.ts',
  'introspect/extractor.ts',
  'introspect/canonical-schema.ts',
  'introspect/overlay.ts',
  'introspect/overlay-tsmorph.ts',
  'introspect/source-overlay/annotations.ts',
  'introspect/source-overlay/handlers.ts',
  'introspect/source-overlay/kernel-calls.ts',
  'introspect/source-overlay/project.ts',
  'introspect/source-overlay/spans.ts',
  'introspect/hash.ts',
  'state/baseline.ts',
  '../shared/types.ts',
]

interface BundleCacheEntry {
  version: number
  key: string
  bundle: StudioSchemaBundle
}

function isCrossDomainImport(value: unknown): boolean {
  const record = asJsonRecord(value)
  return (
    typeof record?.name === 'string' &&
    typeof record.origin === 'string' &&
    (record.definition === 'class' || record.definition === 'interface')
  )
}

function isHandlerLink(value: unknown): boolean {
  const record = asJsonRecord(value)
  return (
    typeof record?.owner === 'string' &&
    ['class', 'interface', 'function'].includes(String(record.ownerKind)) &&
    typeof record.method === 'string' &&
    typeof record.static === 'boolean' &&
    typeof record.implemented === 'boolean'
  )
}

function isSourceSpan(value: unknown): boolean {
  const record = asJsonRecord(value)
  return (
    typeof record?.file === 'string' &&
    asFiniteNumber(record.startLine) !== undefined &&
    asFiniteNumber(record.endLine) !== undefined &&
    (record.doc === undefined || typeof record.doc === 'string')
  )
}

function isAnnotation(value: unknown): boolean {
  const record = asJsonRecord(value)
  return (
    typeof record?.target === 'string' &&
    (record.severity === 'warn' || record.severity === 'info') &&
    (record.code === 'COMPILE_ERROR' || record.code === 'EDGE_PROP_TYPE_MISSING') &&
    typeof record.message === 'string'
  )
}

function decodeOverlay(value: unknown): SchemaOverlay | undefined {
  const record = asJsonRecord(value)
  const requires = asStringArray(record?.requires)
  const crossDomainImports = record?.crossDomainImports
  const mixins = record?.mixins
  const handlerLinks = record?.handlerLinks
  const sourceSpans = asJsonRecord(record?.sourceSpans)
  const annotations = record?.annotations
  if (
    typeof record?.origin !== 'string' ||
    !requires ||
    !Array.isArray(crossDomainImports) ||
    !crossDomainImports.every(isCrossDomainImport) ||
    !Array.isArray(mixins) ||
    !mixins.every(isCrossDomainImport) ||
    !Array.isArray(handlerLinks) ||
    !handlerLinks.every(isHandlerLink) ||
    !sourceSpans ||
    !Object.values(sourceSpans).every(isSourceSpan) ||
    !Array.isArray(annotations) ||
    !annotations.every(isAnnotation)
  ) {
    return undefined
  }
  return record as unknown as SchemaOverlay
}

function decodeBundle(value: unknown): StudioSchemaBundle | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  const domainId = asString(record.domainId)
  const renderFingerprint = asString(record.renderFingerprint)
  const schemaMode = (
    ['canonical-admitted', 'canonical-preview', 'legacy', 'unavailable'] as const
  ).find((candidate) => candidate === record.schemaMode)
  const extractedBy = record.extractedBy
  const depsInstalled = asBoolean(record.depsInstalled)
  const ir = record.ir === null ? null : decodeSchemaIR(record.ir)
  const overlay = decodeOverlay(record.overlay)
  const extractedAt = asString(record.extractedAt)
  if (
    !domainId ||
    renderFingerprint === undefined ||
    !schemaMode ||
    (extractedBy !== 'runtime-bun' && extractedBy !== 'static-tsmorph-fallback') ||
    depsInstalled === undefined ||
    ir === undefined ||
    !overlay ||
    !extractedAt
  ) {
    return undefined
  }
  const schemaRevision = record.schemaRevision
  if (schemaRevision !== undefined && !isSchemaRevision(schemaRevision)) return undefined
  if (
    schemaMode === 'canonical-admitted' &&
    (!isSchemaRevision(schemaRevision) || !isCanonicalDomainSchemaV1(record.schemaRoot))
  ) {
    return undefined
  }
  const importedInterfaces =
    record.importedInterfaces === undefined
      ? undefined
      : decodeIrInterfaceRecord(record.importedInterfaces)
  if (record.importedInterfaces !== undefined && importedInterfaces === undefined) return undefined
  const errorRecord = record.error === null ? null : asJsonRecord(record.error)
  const errorMessage = asString(errorRecord?.message)
  if (record.error !== undefined && record.error !== null && errorMessage === undefined) {
    return undefined
  }
  return {
    domainId,
    renderFingerprint,
    schemaMode,
    ...(schemaRevision === undefined ? {} : { schemaRevision }),
    extractedBy,
    depsInstalled,
    ir,
    ...(record.schemaRoot === undefined ? {} : { schemaRoot: record.schemaRoot }),
    overlay,
    ...(importedInterfaces === undefined ? {} : { importedInterfaces }),
    ...(record.error === undefined
      ? {}
      : record.error === null
        ? { error: null }
        : {
            error: {
              message: errorMessage!,
              ...(typeof errorRecord!.file === 'string' ? { file: errorRecord!.file } : {}),
            },
          }),
    extractedAt,
  }
}

export function decodeBundleCacheEntry(value: unknown): BundleCacheEntry | undefined {
  const record = asJsonRecord(value)
  const version = asFiniteNumber(record?.version)
  const key = asString(record?.key)
  const bundle = decodeBundle(record?.bundle)
  return version !== undefined && key !== undefined && bundle ? { version, key, bundle } : undefined
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
  const entry = readJson(root, BUNDLE_CACHE_FILE, decodeBundleCacheEntry, null)
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
  const anatomy = Promise.all([resolveClientPackage(h.root, rebuild), getBundle(id, rebuild)]).then(
    ([client, bundle]) =>
      buildAnatomy({
        root: h.root,
        schemaDirName: h.schemaDirName,
        clientDir: client.status === 'available' ? client.sourceDir : undefined,
        canonicalViews: bundle?.ir?.format === 'astrale.dsl' ? (bundle.ir.views ?? {}) : undefined,
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
  // Core is derived from the canonical schema (or the legacy composition entry),
  // both of which belong to the anatomy invalidation set.
  if (what !== 'schema') cores.delete(id)
}
