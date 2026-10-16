import { readFile } from 'node:fs/promises'
import { z } from 'zod'

import { AstraleError, IdentifierCollisionError, ReservedSlugError } from '../../errors'
import { atomicWrite, withFileLock } from '../../state/files'
import { ExchangeCredentialCache, INSTANCES_PATH, InstallationCache } from '../../state/index'
import { log } from '../terminal/log'
import {
  RESERVED_SLUGS,
  RegistryModeSchema,
  validateName,
  validateUrl,
  type RegistryMode,
} from '../validation'

const InstanceKindSchema = z.enum(['bookmark'])
type InstanceKind = z.infer<typeof InstanceKindSchema>

const InstanceEntrySchema = z.object({
  url: z.string().optional(),
  issuer: z.string().optional(),
  domainIssuer: z.string().optional(),
  createdAt: z.string().optional(),
  slug: z.string().optional(),
  name: z.string().optional(),
  kind: InstanceKindSchema.optional(),
  mode: RegistryModeSchema.optional(),
  defaultIdentity: z.string().optional(),
  caFile: z.string().optional(),
  // WorkOS org captured from `instance create` — authoritative for token
  // scoping (the router's /auth/org lookup is eventually consistent).
  organizationId: z.string().optional(),
})

/**
 * The sole admitted on-disk bookmark registry format.
 */
const INSTANCE_STORE_VERSION = 1 as const

export const InstanceStoreSchema = z.object({
  version: z.literal(INSTANCE_STORE_VERSION),
  active: z.string(),
  instances: z.record(z.string(), InstanceEntrySchema.extend({ url: z.string().min(1) })),
})

export type InstanceEntry = z.infer<typeof InstanceEntrySchema>
export interface InstanceStore {
  active: string
  instances: Record<string, InstanceEntry>
}

type AddInstanceOpts = Omit<InstanceEntry, 'createdAt'>

export type ResolvedInstance = {
  name: string
  kind: InstanceKind | 'managed'
  url: string
  issuer?: string
  /** Exact Domain issuer the bookmark's users are exchanged at. */
  domainIssuer?: string
  createdAt?: string
  defaultIdentity?: string
  caFile?: string
  mode?: RegistryMode
  status?: string
}

type BookmarkTrustConflict = {
  readonly name: string
  readonly caFile: string | null
}

function seed(): InstanceStore {
  return { active: '', instances: {} }
}

/**
 * Normalize a parsed registry, preserving every explicit Domain issuer. The returned store carries
 * no format label, which only an encoded registry holds.
 */
export function sanitizeStore(store: InstanceStore): InstanceStore {
  const instances: Record<string, InstanceEntry> = {}
  for (const [key, entry] of Object.entries(store.instances)) {
    if (!entry.url) {
      throw new AstraleError('INSTANCE_STATE_INVALID', `Bookmark "${key}" has no connection URL.`)
    }
    instances[key] = {
      ...entry,
      url: normalizeInstanceKernelUrl(entry.url),
      issuer: entry.issuer ? normalizeInstanceKernelUrl(entry.issuer) : entry.issuer,
      kind: 'bookmark',
    }
  }
  return { active: store.active || Object.keys(instances)[0] || '', instances }
}

let instancesMemo: InstanceStore | null = null

/**
 * Invalidate the one-process bookmark snapshot. Long-lived
 * consumers call this before a read so CLI writes made by another process are
 * observable; one-shot commands normally never need it.
 */
export function resetInstancesMemo(): void {
  instancesMemo = null
}

export async function readInstances(): Promise<InstanceStore> {
  if (instancesMemo) return instancesMemo
  let raw: string
  try {
    raw = await readFile(INSTANCES_PATH, 'utf-8')
  } catch {
    instancesMemo = seed()
    return instancesMemo
  }

  let parsed: InstanceStore
  try {
    parsed = decodeInstanceStore(raw)
  } catch (e) {
    if (e instanceof AstraleError) throw e
    const reason = e instanceof z.ZodError ? 'invalid schema' : 'corrupt JSON'
    log.warn(`Could not read instances at ${INSTANCES_PATH} (${reason}) — using empty registry`)
    instancesMemo = seed()
    return instancesMemo
  }

  const store = sanitizeStore(parsed)
  instancesMemo = store
  // Reads never publish a stale snapshot. Normalization is persisted by the
  // next locked mutation, after rereading the current on-disk registry.
  return store
}

/** Serialize the complete read/modify/replace transition across CLI processes. */
async function mutateInstances<Value>(transition: (store: InstanceStore) => Value): Promise<Value> {
  return withFileLock(`${INSTANCES_PATH}.lock`, async () => {
    let raw: string | undefined
    try {
      raw = await readFile(INSTANCES_PATH, 'utf8')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    // Unlike a diagnostic read, a write must never replace corrupt/unreadable
    // evidence with an empty registry.
    const store = raw === undefined ? seed() : sanitizeStore(decodeInstanceStore(raw))
    const value = transition(store)
    await atomicWrite(INSTANCES_PATH, encodeInstanceStore(store))
    instancesMemo = store
    return value
  })
}

function decodeInstanceStore(raw: string): InstanceStore {
  const input: unknown = JSON.parse(raw)
  if (
    typeof input === 'object' &&
    input !== null &&
    (!Object.hasOwn(input, 'version') ||
      (input as { version?: unknown }).version !== INSTANCE_STORE_VERSION)
  ) {
    throw new AstraleError(
      'INSTANCE_STATE_VERSION_UNSUPPORTED',
      `Instance state at ${INSTANCES_PATH} has no supported version.`,
      'Rename this file to preserve it, then run astrale instance use <name> or astrale instance bookmark <name> --url <url>. Keep the keys directory unchanged.',
    )
  }
  return InstanceStoreSchema.parse(input)
}

/**
 * The V1 bytes for a registry written before the format label, or undefined when `raw` is not one
 * this release can convert. Those releases skipped the retired `manager` entry and entries without
 * a connection URL on every read; the upgrade drops them the same way.
 */
export function upgradeUnversionedInstanceState(raw: string): string | undefined {
  const input: unknown = JSON.parse(raw)
  if (typeof input !== 'object' || input === null || Object.hasOwn(input, 'version')) return
  const { active, instances } = input as { active?: unknown; instances?: unknown }
  if (typeof instances !== 'object' || instances === null) return
  const kept = Object.fromEntries(
    Object.entries(instances).filter(
      ([key, entry]) =>
        key !== 'manager' && typeof (entry as { url?: unknown } | null)?.url === 'string',
    ),
  )
  const parsed = InstanceStoreSchema.safeParse({
    version: INSTANCE_STORE_VERSION,
    active: typeof active === 'string' && Object.hasOwn(kept, active) ? active : '',
    instances: kept,
  })
  return parsed.success ? encodeInstanceStore(sanitizeStore(parsed.data)) : undefined
}

/** Every write publishes the whole registry in this release's format. */
function encodeInstanceStore(store: InstanceStore): string {
  const encoded = {
    version: INSTANCE_STORE_VERSION,
    active: store.active,
    instances: store.instances,
  }
  return `${JSON.stringify(encoded, null, 2)}\n`
}

function collectIdentifiers(store: InstanceStore, skipKey?: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, entry] of Object.entries(store.instances)) {
    if (key === skipKey) continue
    out.set(key, `instance key "${key}"`)
    if (entry.slug && !out.has(entry.slug)) out.set(entry.slug, `slug of instance "${key}"`)
    if (entry.name && !out.has(entry.name)) out.set(entry.name, `name of instance "${key}"`)
  }
  return out
}

export function assertNoCollision(
  store: InstanceStore,
  identifiers: string[],
  ignoreKey?: string,
): void {
  // Skip the ignored entry at collection time (never delete by identifier
  // string: another entry may own the same slug/name alias).
  const existing = collectIdentifiers(store, ignoreKey)
  for (const id of identifiers) {
    if (!id) continue
    const owner = existing.get(id)
    if (owner) throw new IdentifierCollisionError(id, owner)
  }
}

export function resolveInstanceKey(store: InstanceStore, identifier: string): string | null {
  if (Object.hasOwn(store.instances, identifier)) return identifier
  for (const [key, entry] of Object.entries(store.instances)) {
    if (entry.slug === identifier || entry.name === identifier) return key
  }
  return null
}

/**
 * Find other bookmarks for the same normalized Kernel URL whose TLS trust
 * configuration differs. System trust (`undefined`) is a configuration too:
 * mixing it with a custom CA is exactly as significant as mixing two CA files.
 */
export function findBookmarkTrustConflicts(
  store: InstanceStore,
  name: string,
  url: string,
  caFile?: string,
): BookmarkTrustConflict[] {
  const normalizedUrl = normalizeInstanceKernelUrl(url)
  const configuredCa = caFile ?? null
  return Object.entries(store.instances).flatMap(([candidateName, entry]) => {
    if (
      candidateName === name ||
      entry.url === undefined ||
      normalizeInstanceKernelUrl(entry.url) !== normalizedUrl ||
      (entry.caFile ?? null) === configuredCa
    ) {
      return []
    }
    return [{ name: candidateName, caFile: entry.caFile ?? null }]
  })
}

export async function upsertInstance(
  key: string,
  opts: AddInstanceOpts = {},
  behavior: Readonly<{
    activateWhenEmpty?: boolean
    /** Drop the exact Domain issuer the existing bookmark carries before applying `opts`. */
    dropDomainIssuer?: boolean
  }> = {},
): Promise<{ entry: InstanceEntry; created: boolean }> {
  validateName(key, 'Instance')
  if (RESERVED_SLUGS.has(key)) throw new ReservedSlugError(key)
  if (!opts.url) throw new Error('Instance bookmarks require --url <url>')
  const normalizedUrl = normalizeInstanceKernelUrl(opts.url)
  validateUrl(normalizedUrl)

  return mutateInstances((store) => upsertBookmark(store, key, opts, normalizedUrl, behavior))
}

function upsertBookmark(
  store: InstanceStore,
  key: string,
  opts: AddInstanceOpts,
  normalizedUrl: string,
  behavior: Readonly<{ activateWhenEmpty?: boolean; dropDomainIssuer?: boolean }> = {},
): { entry: InstanceEntry; created: boolean } {
  assertNoCollision(store, [key, opts.slug, opts.name].filter(Boolean) as string[], key)

  const existing = store.instances[key]
  const kept =
    behavior.dropDomainIssuer === true && existing !== undefined
      ? withoutDomainIssuer(existing)
      : existing
  const normalizedIssuer = opts.issuer ? normalizeInstanceKernelUrl(opts.issuer) : undefined
  const normalizedDomainIssuer = opts.domainIssuer
    ? normalizeIssuerUrl(opts.domainIssuer)
    : undefined
  const entry: InstanceEntry = {
    ...kept,
    ...definedEntry(opts),
    url: normalizedUrl,
    ...(normalizedIssuer ? { issuer: normalizedIssuer } : {}),
    ...(normalizedDomainIssuer ? { domainIssuer: normalizedDomainIssuer } : {}),
    kind: 'bookmark',
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  }
  store.instances[key] = entry
  if (!store.active && behavior.activateWhenEmpty !== false) store.active = key
  return { entry, created: !existing }
}

/** Register a verified creation without changing existing bookmark ownership or selection. */
export async function bookmarkCreatedInstance(
  input: Readonly<{
    slug: string
    url: string
    organizationId?: string
    defaultIdentity?: string
  }>,
): Promise<{ name: string; entry: InstanceEntry }> {
  validateName(input.slug, 'Instance')
  if (RESERVED_SLUGS.has(input.slug)) throw new ReservedSlugError(input.slug)
  const url = normalizeInstanceKernelUrl(input.url)
  validateUrl(url)

  return mutateInstances((store) => {
    const existingKey = resolveInstanceKey(store, input.slug)
    if (existingKey !== null) {
      const entry = store.instances[existingKey]!
      if (entry.url !== url) {
        const quotedUrl = `'${url.replaceAll("'", "'\\''")}'`
        throw new AstraleError(
          'INSTANCE_BOOKMARK_CONFLICT',
          `Instance "${input.slug}" is ready, but bookmark "${existingKey}" already names ${entry.url}. The existing bookmark and active target were preserved.`,
          `Choose an unused bookmark name: astrale instance bookmark <new-name> --url ${quotedUrl}${input.defaultIdentity ? ` --as ${input.defaultIdentity}` : ''}`,
        )
      }
      // A ready receipt replay must not rewrite aliases, trust or the bookmark's identity.
      return { name: existingKey, entry }
    }
    const { entry } = upsertBookmark(store, input.slug, managedEntry(input, url), url)
    return { name: input.slug, entry }
  })
}

/**
 * Bookmark an admin-managed instance under `key` (url = issuer = the
 * normalized kernel URL). Reports the previous URL when an existing
 * bookmark was repointed to a different kernel so callers can warn.
 */
export async function upsertManagedBookmark(
  input: Readonly<{
    key: string
    slug: string
    url: string
    organizationId?: string
    defaultIdentity?: string
    activateWhenEmpty?: boolean
  }>,
): Promise<{ entry: InstanceEntry; repointedFrom?: string }> {
  const store = await readInstances()
  const previousUrl = store.instances[input.key]?.url
  const url = normalizeInstanceKernelUrl(input.url)
  const { entry } = await upsertInstance(input.key, managedEntry(input, url), {
    activateWhenEmpty: input.activateWhenEmpty,
    // A managed route's users act for themselves: `instance use` resets any exchange issuer.
    dropDomainIssuer: isManagedRoute(url),
  })
  return {
    entry,
    ...(previousUrl && previousUrl !== entry.url ? { repointedFrom: previousUrl } : {}),
  }
}

/** The bookmark of an Admin-managed Instance: its Kernel URL is its issuer, its slug its name. */
function managedEntry(
  input: Readonly<{ slug: string; organizationId?: string; defaultIdentity?: string }>,
  url: string,
): AddInstanceOpts {
  return {
    url,
    issuer: url,
    slug: input.slug,
    name: input.slug,
    mode: 'remote',
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    ...(input.defaultIdentity ? { defaultIdentity: input.defaultIdentity } : {}),
  }
}

/** Whether a route is an Astrale-managed public Instance, whose users act for themselves. */
export function isManagedRoute(input: string): boolean {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return false
  }
  return url.protocol === 'https:' && url.hostname.endsWith('.astrale.ai')
}

function withoutDomainIssuer(entry: InstanceEntry): InstanceEntry {
  const { domainIssuer: _replaced, ...rest } = entry
  return rest
}

export async function removeInstance(key: string): Promise<void> {
  const removed = await mutateInstances((store) => {
    if (!Object.hasOwn(store.instances, key)) throw new Error(`Instance "${key}" not found`)
    return deleteBookmark(store, key)
  })
  await forgetKernel(removed.issuer ?? removed.url!)
}

/** Remove only the bookmark still naming the deleted Admin Instance's exact Kernel. */
export async function removeDeletedInstanceBookmark(target: {
  readonly slug: string
  readonly url: string
  readonly issuer?: string
}): Promise<void> {
  const url = bookmarkCoordinate(target.url)
  const issuer = bookmarkCoordinate(target.issuer)
  if ((!url && !issuer) || (target.url && !url) || (target.issuer && !issuer)) return

  const removed = await mutateInstances((store) => {
    const key = resolveInstanceKey(store, target.slug)
    const entry = key === null ? undefined : store.instances[key]
    if (
      !key ||
      !entry ||
      bookmarkCoordinate(entry.url) !== (url ?? issuer) ||
      (issuer !== undefined && bookmarkCoordinate(entry.issuer ?? entry.url) !== issuer)
    )
      return undefined
    return deleteBookmark(store, key)
  })
  if (removed) await forgetKernel(removed.issuer ?? removed.url!)
}

/** Delete bookmark `key`; the first remaining bookmark becomes active when it was. */
function deleteBookmark(store: InstanceStore, key: string): InstanceEntry {
  const entry = store.instances[key]!
  delete store.instances[key]
  if (store.active === key) store.active = Object.keys(store.instances)[0] ?? ''
  return entry
}

async function forgetKernel(kernelIssuer: string): Promise<void> {
  await new ExchangeCredentialCache().deleteKernel(kernelIssuer)
  await new InstallationCache().deleteKernel(kernelIssuer)
}

function bookmarkCoordinate(value: string | undefined): string | undefined {
  if (!value || !URL.canParse(value)) return undefined
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
  return normalizeInstanceKernelUrl(value)
}

export async function setActive(identifier: string): Promise<string> {
  return mutateInstances((store) => {
    const key = resolveInstanceKey(store, identifier)
    if (!key) {
      throw new Error(
        `Instance "${identifier}" is not bookmarked. Run: astrale instance bookmark ${identifier} --url <url>`,
      )
    }
    store.active = key
    return key
  })
}

/** The name of the active bookmark of `store`; there is always one to name, or this refuses. */
export function activeName(store: InstanceStore): string {
  if (!store.active) {
    throw new AstraleError(
      'INSTANCE_NOT_FOUND',
      'No active instance. Run: astrale instance bookmark <name> --url <url> --use',
    )
  }
  return store.active
}

export async function getActive(): Promise<InstanceEntry & { name: string }> {
  const store = await readInstances()
  const name = activeName(store)
  return { ...store.instances[name], name }
}

export async function resolveInstance(identifier: string): Promise<ResolvedInstance> {
  return bookmarkIn(await readInstances(), identifier)
}

/** The bookmark `identifier` names in `store`, by key, slug or name. */
export function bookmarkIn(store: InstanceStore, identifier: string): ResolvedInstance {
  const key = resolveInstanceKey(store, identifier)
  const entry = key ? store.instances[key] : undefined
  if (!key || !entry?.url) {
    throw new AstraleError(
      'INSTANCE_NOT_FOUND',
      `Instance "${identifier}" is not bookmarked.\n` +
        `  Bookmark: astrale instance bookmark ${identifier} --url <url>\n` +
        `  Or pass --url <kernel-url> directly.`,
    )
  }
  const url = normalizeInstanceKernelUrl(entry.url)
  return {
    name: key,
    kind: 'bookmark',
    url,
    issuer: entry.issuer ? normalizeInstanceKernelUrl(entry.issuer) : entry.issuer,
    ...(entry.domainIssuer === undefined ? {} : { domainIssuer: entry.domainIssuer }),
    createdAt: entry.createdAt,
    defaultIdentity: entry.defaultIdentity,
    caFile: entry.caFile,
    mode: entry.mode,
  }
}

/**
 * The bookmarked org id for the instance matching `audience`'s origin —
 * consulted before the router's eventually-consistent `/auth/org`.
 */
export async function orgIdForAudience(audience: string): Promise<string | undefined> {
  let origin: string
  try {
    origin = new URL(audience).origin
  } catch {
    return undefined
  }
  const store = await readInstances()
  for (const entry of Object.values(store.instances)) {
    if (!entry.organizationId || !entry.url) continue
    try {
      if (new URL(entry.url).origin === origin) return entry.organizationId
    } catch {
      // unparsable bookmark URL — skip
    }
  }
  return undefined
}

export function normalizeInstanceKernelUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (!isRegionRoutedInstanceRoot(parsed)) return url.replace(/\/$/, '')

  parsed.pathname = '/api'
  return parsed.toString().replace(/\/$/, '')
}

function normalizeIssuerUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return url
    parsed.pathname = parsed.pathname.replace(/\/+$/u, '') || '/'
    return parsed.toString().replace(/\/$/u, '')
  } catch {
    return url
  }
}

/** The root of an instance the Admin router serves: `https://<slug>.<region>.astrale.ai`. */
function isRegionRoutedInstanceRoot(url: URL): boolean {
  if (url.pathname !== '' && url.pathname !== '/') return false
  if (url.search || url.hash) return false

  const labels = url.hostname.toLowerCase().split('.')
  return (
    labels.length === 4 &&
    /^[a-z]{2}(?:-[a-z0-9]+)*$/u.test(labels[1] ?? '') &&
    labels.at(-2) === 'astrale' &&
    labels.at(-1) === 'ai'
  )
}

function definedEntry(entry: AddInstanceOpts): AddInstanceOpts {
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined),
  ) as AddInstanceOpts
}
