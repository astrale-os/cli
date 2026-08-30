import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import type { AstraleConfig } from './config'

import { AstraleError, IdentifierCollisionError, ReservedSlugError } from '../errors'
import { ExchangeCredentialCache, INSTANCES_PATH } from '../state/index'
import { log } from './log'
import {
  RESERVED_SLUGS,
  RegistryModeSchema,
  validateName,
  validateUrl,
  type RegistryMode,
} from './validation'

export const InstanceKindSchema = z.enum(['bookmark'])
export type InstanceKind = z.infer<typeof InstanceKindSchema>

export const InstanceEntrySchema = z.object({
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

export const InstanceStoreSchema = z.object({
  active: z.string(),
  instances: z.record(z.string(), InstanceEntrySchema),
})

export type InstanceEntry = z.infer<typeof InstanceEntrySchema>
export type InstanceStore = z.infer<typeof InstanceStoreSchema>

export type AddInstanceOpts = {
  url?: string
  slug?: string
  name?: string
  kind?: InstanceKind
  mode?: RegistryMode
  issuer?: string
  domainIssuer?: string
  defaultIdentity?: string
  caFile?: string
  organizationId?: string
}

export type ResolvedInstance = {
  name: string
  kind: InstanceKind | 'managed'
  url: string
  issuer?: string
  domainIssuer?: string
  createdAt?: string
  defaultIdentity?: string
  caFile?: string
  mode?: RegistryMode
  status?: string
}

export type BookmarkTrustConflict = {
  readonly name: string
  readonly caFile: string | null
}

function seed(): InstanceStore {
  return { active: '', instances: {} }
}

export function sanitizeStore(store: InstanceStore): { store: InstanceStore; changed: boolean } {
  let changed = false
  const instances: Record<string, InstanceEntry> = {}

  for (const [key, entry] of Object.entries(store.instances)) {
    if (key === 'manager') {
      changed = true
      continue
    }
    if (!entry.url) {
      changed = true
      continue
    }
    const normalizedUrl = normalizeInstanceKernelUrl(entry.url)
    const normalizedIssuer = entry.issuer ? normalizeInstanceKernelUrl(entry.issuer) : entry.issuer
    const domainIssuer =
      entry.domainIssuer ??
      (entry.slug !== undefined && entry.name !== undefined
        ? managedShellDomainIssuer(normalizedUrl)
        : undefined)
    const next: InstanceEntry = {
      ...entry,
      url: normalizedUrl,
      issuer: normalizedIssuer,
      domainIssuer,
      kind: 'bookmark',
    }
    // VALUE comparison only. The old `next !== entry` (object identity) was
    // ALWAYS true, so every read rewrote instances.json fire-and-forget —
    // concurrent astrale processes clobbered each other's `active` from
    // stale snapshots (observed: `instance create` setting the active
    // target, then a parallel command silently reverting it — every call
    // after that wrote to the WRONG instance).
    if (
      entry.kind !== 'bookmark' ||
      normalizedUrl !== entry.url ||
      normalizedIssuer !== entry.issuer ||
      domainIssuer !== entry.domainIssuer
    ) {
      changed = true
    }
    instances[key] = next
  }

  const active = store.active || Object.keys(instances)[0] || ''
  if (active !== store.active) changed = true
  return { store: { active, instances }, changed }
}

let instancesMemo: InstanceStore | null = null

/**
 * Invalidate the one-process bookmark snapshot. Long-lived compatibility
 * consumers call this before a read so CLI writes made by another process are
 * observable; one-shot commands normally never need it.
 */
export function resetInstancesMemo(): void {
  instancesMemo = null
}

export async function readInstances(
  _config?: AstraleConfig,
  opts: { persist?: boolean } = {},
): Promise<InstanceStore> {
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
    parsed = InstanceStoreSchema.parse(JSON.parse(raw))
  } catch (e) {
    const reason = e instanceof z.ZodError ? 'invalid schema' : 'corrupt JSON'
    log.warn(`Could not read instances at ${INSTANCES_PATH} (${reason}) — using empty registry`)
    instancesMemo = seed()
    return instancesMemo
  }

  const { store, changed } = sanitizeStore(parsed)
  instancesMemo = store
  // Self-heal a stale/unnormalized store on read — but never from a read-only
  // caller (`opts.persist: false`, e.g. status / `setup --plan`). Any mutating
  // path reads with the default and rewrites, so healing still happens there.
  if (changed && opts.persist !== false) writeInstances(store).catch(() => undefined)
  return store
}

export async function writeInstances(store: InstanceStore): Promise<void> {
  await mkdir(dirname(INSTANCES_PATH), { recursive: true })
  await writeFile(INSTANCES_PATH, JSON.stringify(store, null, 2) + '\n')
  instancesMemo = store
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
  if (store.instances[identifier]) return identifier
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

export async function addInstance(key: string, opts: AddInstanceOpts = {}): Promise<InstanceEntry> {
  validateName(key, 'Instance')
  if (RESERVED_SLUGS.has(key)) throw new ReservedSlugError(key)
  if (!opts.url) throw new Error('Instance bookmarks require --url <url>')
  const normalizedUrl = normalizeInstanceKernelUrl(opts.url)
  validateUrl(normalizedUrl)

  const store = await readInstances()
  if (store.instances[key]) {
    throw new Error(
      `Instance "${key}" already exists. Remove it first with: astrale instance forget ${key}`,
    )
  }
  assertNoCollision(store, [key, opts.slug, opts.name].filter(Boolean) as string[])

  const entry: InstanceEntry = {
    ...opts,
    url: normalizedUrl,
    issuer: opts.issuer ? normalizeInstanceKernelUrl(opts.issuer) : opts.issuer,
    domainIssuer: opts.domainIssuer ? normalizeIssuerUrl(opts.domainIssuer) : opts.domainIssuer,
    kind: 'bookmark',
    createdAt: new Date().toISOString(),
  }
  store.instances[key] = entry
  if (!store.active) store.active = key
  await writeInstances(store)
  return entry
}

export async function upsertInstance(
  key: string,
  opts: AddInstanceOpts = {},
): Promise<{ entry: InstanceEntry; created: boolean }> {
  validateName(key, 'Instance')
  if (RESERVED_SLUGS.has(key)) throw new ReservedSlugError(key)
  if (!opts.url) throw new Error('Instance bookmarks require --url <url>')
  const normalizedUrl = normalizeInstanceKernelUrl(opts.url)
  validateUrl(normalizedUrl)

  const store = await readInstances()
  assertNoCollision(store, [key, opts.slug, opts.name].filter(Boolean) as string[], key)

  const existing = store.instances[key]
  const normalizedIssuer = opts.issuer ? normalizeInstanceKernelUrl(opts.issuer) : undefined
  const normalizedDomainIssuer = opts.domainIssuer
    ? normalizeIssuerUrl(opts.domainIssuer)
    : undefined
  const entry: InstanceEntry = {
    ...existing,
    ...definedEntry(opts),
    url: normalizedUrl,
    ...(normalizedIssuer ? { issuer: normalizedIssuer } : {}),
    ...(normalizedDomainIssuer ? { domainIssuer: normalizedDomainIssuer } : {}),
    kind: 'bookmark',
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  }
  store.instances[key] = entry
  if (!store.active) store.active = key
  await writeInstances(store)
  return { entry, created: !existing }
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
  }>,
): Promise<{ entry: InstanceEntry; repointedFrom?: string }> {
  const store = await readInstances()
  const previousUrl = store.instances[input.key]?.url
  const url = normalizeInstanceKernelUrl(input.url)
  const domainIssuer = managedShellDomainIssuer(url)
  const { entry } = await upsertInstance(input.key, {
    url,
    issuer: url,
    slug: input.slug,
    name: input.slug,
    kind: 'bookmark',
    mode: 'remote',
    ...(domainIssuer === undefined ? {} : { domainIssuer }),
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    ...(input.defaultIdentity ? { defaultIdentity: input.defaultIdentity } : {}),
  })
  return {
    entry,
    ...(previousUrl && previousUrl !== entry.url ? { repointedFrom: previousUrl } : {}),
  }
}

/** Resolve the trusted Shell issuer for an Astrale-managed public Instance route. */
export function managedShellDomainIssuer(input: string): string | undefined {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:') return undefined
  if (url.hostname.endsWith('.beta.astrale.ai')) return 'https://shell.beta.astrale.ai'
  if (url.hostname.endsWith('.astrale.ai')) return 'https://shell.astrale.ai'
  return undefined
}

export async function removeInstance(key: string): Promise<void> {
  const store = await readInstances()
  const removed = store.instances[key]
  if (!removed) throw new Error(`Instance "${key}" not found`)
  delete store.instances[key]
  if (store.active === key) store.active = Object.keys(store.instances)[0] ?? ''
  await writeInstances(store)
  await new ExchangeCredentialCache().deleteKernel(removed.issuer ?? removed.url!)
}

export async function setActive(identifier: string): Promise<string> {
  const store = await readInstances()
  const key = resolveInstanceKey(store, identifier)
  if (!key) {
    throw new Error(
      `Instance "${identifier}" is not bookmarked. Run: astrale instance bookmark ${identifier} --url <url>`,
    )
  }
  store.active = key
  await writeInstances(store)
  return key
}

export async function clearActive(identifier: string): Promise<void> {
  const store = await readInstances()
  if (store.active !== identifier) return
  store.active = Object.keys(store.instances)[0] ?? ''
  await writeInstances(store)
}

export async function getActive(config?: AstraleConfig): Promise<InstanceEntry & { name: string }> {
  const store = await readInstances(config)
  if (!store.active) {
    throw new AstraleError(
      'INSTANCE_NOT_FOUND',
      'No active instance. Run: astrale instance bookmark <name> --url <url> --use',
    )
  }
  const entry = store.instances[store.active]
  return { ...entry, name: store.active }
}

export async function resolveInstance(
  identifier: string,
  config?: AstraleConfig,
  opts: { persist?: boolean } = {},
): Promise<ResolvedInstance> {
  const store = await readInstances(config, opts)
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
  return {
    name: key,
    kind: 'bookmark',
    url: normalizeInstanceKernelUrl(entry.url),
    issuer: entry.issuer ? normalizeInstanceKernelUrl(entry.issuer) : entry.issuer,
    domainIssuer: entry.domainIssuer,
    createdAt: entry.createdAt,
    defaultIdentity: entry.defaultIdentity,
    caFile: entry.caFile,
    mode: entry.mode,
  }
}

export async function resolveKernelUrl(
  opts: { url?: string; instance?: string },
  config: AstraleConfig,
): Promise<string> {
  if (opts.url) return opts.url
  const identifier = opts.instance ?? (await getActive(config)).name
  return (await resolveInstance(identifier, config)).url
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

export function normalizeIssuerUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return url
    parsed.pathname = parsed.pathname.replace(/\/+$/u, '') || '/'
    return parsed.toString().replace(/\/$/u, '')
  } catch {
    return url
  }
}

function isRegionRoutedInstanceRoot(url: URL): boolean {
  if (url.pathname !== '' && url.pathname !== '/') return false
  if (url.search || url.hash) return false

  const labels = url.hostname.toLowerCase().split('.')
  return (
    (labels.length === 4 || labels.length === 5) &&
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
