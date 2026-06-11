import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import type { AstraleConfig } from './config'

import { AstraleError, IdentifierCollisionError, ReservedSlugError } from '../errors'
import { log } from './log'
import { INSTANCES_PATH } from './paths'
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
  createdAt: z.string().optional(),
  slug: z.string().optional(),
  name: z.string().optional(),
  kind: InstanceKindSchema.optional(),
  mode: RegistryModeSchema.optional(),
  defaultIdentity: z.string().optional(),
  caFile: z.string().optional(),
  /**
   * The WorkOS org this instance pins, captured from `instance create`. The
   * AUTHORITATIVE org for token scoping: the router's `/auth/org` lookup is
   * eventually consistent (KV propagation + colo cache), and a reused slug
   * serves the PREVIOUS instance's org for up to ~90s after create — scoping
   * to it gets "User is not a member of the organization" (observed live
   * 2026-06-11, fresh-user flow).
   */
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
  defaultIdentity?: string
  caFile?: string
  organizationId?: string
}

export type ResolvedInstance = {
  name: string
  kind: InstanceKind | 'managed'
  url: string
  issuer?: string
  createdAt?: string
  defaultIdentity?: string
  caFile?: string
  mode?: RegistryMode
  status?: string
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
    const next: InstanceEntry = {
      ...entry,
      url: normalizedUrl,
      issuer: normalizedIssuer,
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
      normalizedIssuer !== entry.issuer
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

export async function readInstances(_config?: AstraleConfig): Promise<InstanceStore> {
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
  if (changed) writeInstances(store).catch(() => undefined)
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
  const entry: InstanceEntry = {
    ...existing,
    ...definedEntry(opts),
    url: normalizedUrl,
    ...(normalizedIssuer ? { issuer: normalizedIssuer } : {}),
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
  key: string,
  slug: string,
  rawUrl: string,
  organizationId?: string,
): Promise<{ entry: InstanceEntry; repointedFrom?: string }> {
  const store = await readInstances()
  const previousUrl = store.instances[key]?.url
  const url = normalizeInstanceKernelUrl(rawUrl)
  const { entry } = await upsertInstance(key, {
    url,
    issuer: url,
    slug,
    name: slug,
    kind: 'bookmark',
    mode: 'remote',
    ...(organizationId ? { organizationId } : {}),
  })
  return {
    entry,
    ...(previousUrl && previousUrl !== entry.url ? { repointedFrom: previousUrl } : {}),
  }
}

export async function removeInstance(key: string): Promise<void> {
  const store = await readInstances()
  if (!store.instances[key]) throw new Error(`Instance "${key}" not found`)
  delete store.instances[key]
  if (store.active === key) store.active = Object.keys(store.instances)[0] ?? ''
  await writeInstances(store)
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
    throw new Error('No active instance. Run: astrale instance bookmark <name> --url <url> --use')
  }
  const entry = store.instances[store.active]
  return { ...entry, name: store.active }
}

export async function resolveInstance(
  identifier: string,
  config?: AstraleConfig,
): Promise<ResolvedInstance> {
  const store = await readInstances(config)
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
 * The bookmarked WorkOS org id for the instance whose kernel URL shares
 * `audience`'s origin, if any. Consulted BEFORE the router's `/auth/org`
 * lookup: the bookmark value comes straight from `Instance.alphaCreate`, so
 * it can never be stale, while the router read races KV propagation for
 * ~90s after a create (fatal when the slug is reused — see the
 * `organizationId` field doc).
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

function isRegionRoutedInstanceRoot(url: URL): boolean {
  if (url.pathname !== '' && url.pathname !== '/') return false
  if (url.search || url.hash) return false

  const labels = url.hostname.toLowerCase().split('.')
  return labels.length === 4 && labels[2] === 'astrale' && labels[3] === 'ai'
}

function definedEntry(entry: AddInstanceOpts): AddInstanceOpts {
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined),
  ) as AddInstanceOpts
}
