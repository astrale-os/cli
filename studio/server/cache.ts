/**
 * cache.ts — in-memory per-domain caches for the (relatively expensive) bundle
 * and anatomy, so API reads and the file-watcher share one computed value.
 * Watchers invalidate on change; the next read rebuilds and re-broadcasts.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import type {
  DomainAnatomy,
  SchemaOverlay,
  StudioCore,
  StudioDatasets,
  StudioSchemaBundle,
} from '../shared/types'

import { isSchemaRevision } from '../shared/types'
import { invalidateClientPackage, resolveClientPackage } from './client-package'
import { getDomain } from './domain'
import { buildAnatomy } from './introspect/anatomy'
import { buildBundle } from './introspect/bundle'
import { isCanonicalDomainSchemaV1 } from './introspect/canonical-schema'
import { buildCore } from './introspect/core'
import { buildDatasets } from './introspect/datasets'
import { decodeSchemaIR } from './introspect/schema-ir-json'
import { asBoolean, asFiniteNumber, asJsonRecord, asString } from './json'
import { hashAnatomyFiles } from './state/baseline'
import { readJson, writeJson } from './state/store'
import { studioSettings } from './studio-settings'

const bundles = new Map<string, StudioSchemaBundle>()
/**
 * The build a caller can JOIN instead of starting a second one.
 *
 * `bundles` only ever holds a finished bundle, so concurrent readers of a domain
 * that has none yet each used to launch their own extraction: opening the studio
 * asks for `/bundle`, `/anatomy` and `/core` at once, and the boot may still be
 * indexing the same domain — four subprocesses bundling identical sources.
 */
const building = new Map<string, Promise<StudioSchemaBundle>>()
interface AnatomyCacheEntry {
  /** Exact bundle generation whose canonical Views were projected into this anatomy. */
  bundle: StudioSchemaBundle | null
  value: Promise<DomainAnatomy>
}
const anatomies = new Map<string, AnatomyCacheEntry>()
/** Demo Datasets, extracted on demand; they follow the bundle (revision) and the tests/ tree. */
const datasets = new Map<string, Promise<StudioDatasets>>()

const BUNDLE_CACHE_FILE = '.cache/schema-bundle.json'
/**
 * Bump whenever extraction or the overlay can produce a DIFFERENT answer from the
 * same sources. The key below hashes the domain's files and this server's own
 * sources — but a shipped standalone has no sources on disk to hash, so there the
 * version is the only thing that can retire a bundle a newer Studio would compose
 * differently. v7: the overlay reads both of its passes out of one ts-morph project.
 */
const BUNDLE_CACHE_VERSION = 7
const LOCKFILES = ['bun.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']
const TOOL_INPUTS = [
  'cache.ts',
  'domain.ts',
  'introspect/bundle.ts',
  'introspect/runtime.ts',
  'introspect/extractor.ts',
  'introspect/island.ts',
  'introspect/canonical-schema.ts',
  'introspect/overlay.ts',
  'introspect/overlay-tsmorph.ts',
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

function isHandlerLink(value: unknown): boolean {
  const record = asJsonRecord(value)
  return (
    typeof record?.owner === 'string' &&
    ['class', 'function'].includes(String(record.ownerKind)) &&
    ['action', 'workflow'].includes(String(record.kind)) &&
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

function decodeOverlay(value: unknown): SchemaOverlay | undefined {
  const record = asJsonRecord(value)
  const handlerLinks = record?.handlerLinks
  const sourceSpans = asJsonRecord(record?.sourceSpans)
  if (
    !Array.isArray(handlerLinks) ||
    !handlerLinks.every(isHandlerLink) ||
    !sourceSpans ||
    !Object.values(sourceSpans).every(isSourceSpan)
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
  const schemaMode = (['canonical-admitted', 'canonical-preview', 'unavailable'] as const).find(
    (candidate) => candidate === record.schemaMode,
  )
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

function bundleCacheKey(root: string, schemaDirName: string, applicationFile: string): string {
  const hash = createHash('sha256')
  hash.update(`domain-studio-bundle-cache-v${BUNDLE_CACHE_VERSION}\0`)
  hash.update(`schema-dir:${schemaDirName}\0`)
  hash.update(`bun:${Bun.version}\0`)

  const files = hashAnatomyFiles(root, schemaDirName, applicationFile)
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

/**
 * How long a failed extraction is allowed to stand in for a real one.
 *
 * Everything else here is keyed to the sources and stays valid until they change,
 * which is right for a bundle: it is derived from them. A FAILURE is not — it is a
 * fact about a moment, a machine that was busy, a lock held elsewhere, an extractor
 * that ran out of its deadline. Kept like a success it would leave an empty canvas
 * until someone edited the schema or deleted a cache directory they cannot see;
 * kept for no time at all it would re-run a 20 s extraction on every request of a
 * domain that really is broken. So it stands briefly, and then the next reader
 * tries again — the domain heals itself the moment the cause clears.
 */
const FAILED_BUNDLE_TTL_MS = 60_000

/** A bundle to serve, or a failure old enough to be worth retrying? */
export function stillStands(bundle: StudioSchemaBundle): boolean {
  if (!bundle.error) return true
  const extractedAt = Date.parse(bundle.extractedAt)
  return Number.isFinite(extractedAt) && Date.now() - extractedAt < FAILED_BUNDLE_TTL_MS
}

/**
 * Background indexing steps aside for a reader.
 *
 * The schema itself is extracted in a subprocess, but hashing the domain's files
 * and composing its ts-morph overlay run HERE, on the thread that answers HTTP —
 * a few hundred milliseconds per domain, back to back for a whole workspace. A
 * build somebody is waiting on says so; the boot loop asks for a gap before it
 * picks up its next domain, and the reader's canvas is not stuck behind an
 * indexing pass it does not care about.
 */
let awaitedBuilds = 0
const gapWaiters: (() => void)[] = []

/** Resolves as soon as no reader is waiting on a bundle of their own. */
export function buildGap(): Promise<void> {
  if (awaitedBuilds === 0) return Promise.resolve()
  return new Promise((resolve) => gapWaiters.push(resolve))
}

export async function getBundle(
  id: string,
  rebuild = false,
  /** Startup indexing: nobody is on the other end of this one. */
  background = false,
): Promise<StudioSchemaBundle | null> {
  const h = getDomain(id)
  if (!h) return null
  const held = bundles.get(id)
  if (!rebuild && held && stillStands(held)) return held

  if (!background) awaitedBuilds++
  try {
    // A plain read joins whatever build is already running; a rebuild is a demand
    // for fresh sources, so it starts its own — later readers then join THAT one.
    const running = building.get(id)
    if (!rebuild && running) return await running

    const run = (async (): Promise<StudioSchemaBundle> => {
      const keyBefore = bundleCacheKey(h.root, h.schemaDirName, h.applicationFile)
      if (!rebuild) {
        const cached = readCachedBundle(h.root, keyBefore)
        if (cached && stillStands(cached)) {
          if (cached.ir) h.origin = cached.ir.domain
          bundles.set(id, cached)
          return cached
        }
      }
      const b = await buildBundle(h)
      bundles.set(id, b)
      const keyAfter = bundleCacheKey(h.root, h.schemaDirName, h.applicationFile)
      if (keyAfter === keyBefore) writeCachedBundle(h.root, keyAfter, b)
      return b
    })()

    building.set(id, run)
    try {
      return await run
    } finally {
      if (building.get(id) === run) building.delete(id)
    }
  } finally {
    if (!background && --awaitedBuilds === 0) {
      for (const wake of gapWaiters.splice(0)) wake()
    }
  }
}

export async function getAnatomy(id: string, rebuild = false): Promise<DomainAnatomy | null> {
  const h = getDomain(id)
  if (!h) return null

  // Anatomy contains the bundle's canonical Views. Reuse it only while the exact
  // bundle generation that produced it still stands; a transient extraction
  // failure may expire and heal without any file-watcher invalidation.
  const heldBundle = bundles.get(id)
  const heldAnatomy = anatomies.get(id)
  if (!rebuild && heldBundle && stillStands(heldBundle) && heldAnatomy?.bundle === heldBundle) {
    return heldAnatomy.value
  }

  const [client, bundle] = await Promise.all([
    resolveClientPackage(h.root, rebuild),
    getBundle(id, rebuild),
  ])
  // Concurrent anatomy readers can both have joined the same bundle build. Let
  // the first projection win instead of repeating the synchronous source walk.
  const current = anatomies.get(id)
  if (!rebuild && current?.bundle === bundle) return current.value

  const anatomy = Promise.resolve().then(() =>
    buildAnatomy({
      root: h.root,
      schemaDirName: h.schemaDirName,
      clientDir: client.status === 'available' ? client.sourceDir : undefined,
      canonicalViews: bundle?.ir?.format === 'astrale.dsl' ? (bundle.ir.views ?? {}) : undefined,
    }),
  )
  anatomies.set(id, { bundle, value: anatomy })
  return anatomy
}

export async function getCore(id: string, rebuild = false): Promise<StudioCore | null> {
  const h = getDomain(id)
  if (!h) return null
  return buildCore(h, await getBundle(id, rebuild))
}

export async function getDatasets(id: string, rebuild = false): Promise<StudioDatasets | null> {
  const h = getDomain(id)
  if (!h) return null
  if (!rebuild && datasets.has(id)) return datasets.get(id)!
  const run = getBundle(id, rebuild).then((bundle) =>
    buildDatasets(h, bundle, studioSettings().introspectTimeoutMs),
  )
  datasets.set(id, run)
  return run
}

export function invalidateDatasets(id: string): void {
  datasets.delete(id)
}

export function invalidate(id: string, what: 'schema' | 'anatomy' | 'all'): void {
  if (what !== 'anatomy') {
    bundles.delete(id)
    datasets.delete(id)
  }
  if (what !== 'schema') {
    anatomies.delete(id)
    const domain = getDomain(id)
    if (domain) invalidateClientPackage(domain.root)
  }
}
