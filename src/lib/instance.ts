import { KernelClient } from '@astrale-os/kernel-client'
import { ClientSession } from '@astrale-os/kernel-client/session'
import { readFile, unlink, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import type { AstraleConfig } from './config'

import { AstraleError, IdentifierCollisionError, ReservedSlugError } from '../errors'
import { resolveCredential } from '../kernel/auth'
import { readConfig } from './config'
import { log } from './log'
import { INSTANCES_PATH, MANAGER_CACHE_PATH } from './paths'
import {
  RESERVED_SLUGS,
  RegistryModeSchema,
  validateName,
  validateSlug,
  validateUrl,
  type RegistryMode,
} from './validation'

/** Base URL of the local manager's management API (§3.2). */
export function managerUrl(config: { managerPort: number }): string {
  return `http://localhost:${config.managerPort}/mngt`
}

// ─── Schemas ─────────────────────────────────────────────────

/**
 * Instance kinds (§4).
 *   - manager        : the local manager instance (reserved slug "manager")
 *   - local-child    : child instance of the local manager
 *   - managed-cloud  : instance provisioned by astrale cloud (managed)
 *   - bookmark       : remote instance reference (no kernel-side ownership)
 */
export const InstanceKindSchema = z.enum(['manager', 'local-child', 'managed-cloud', 'bookmark'])
export type InstanceKind = z.infer<typeof InstanceKindSchema>

export const InstanceEntrySchema = z.object({
  // For `bookmark` entries: url + issuer are the source of truth (the local
  // manager has no visibility into remote kernels). For `manager` and
  // `local-child` entries these are resolved live via `resolveInstance`
  // and are stripped at read time (see `sanitizeEntry`).
  url: z.string().optional(),
  issuer: z.string().optional(),
  createdAt: z.string().optional(),
  // Extensions — all optional for backward compat on legacy registries.
  slug: z.string().optional(),
  name: z.string().optional(),
  kind: InstanceKindSchema.optional(),
  mode: RegistryModeSchema.optional(),
  defaultIdentity: z.string().optional(),
})

export const InstanceStoreSchema = z.object({
  active: z.string(),
  instances: z.record(z.string(), InstanceEntrySchema),
})

export type InstanceEntry = z.infer<typeof InstanceEntrySchema>
export type InstanceStore = z.infer<typeof InstanceStoreSchema>

// ─── Seed ───────────────────────────────────────────────────

function seed(_config?: AstraleConfig): InstanceStore {
  return {
    active: 'manager',
    instances: {
      manager: { kind: 'manager', slug: 'manager', mode: 'local' },
    },
  }
}

// ─── Persistence ────────────────────────────────────────────

/**
 * Strip fields that are manager-side source-of-truth from local-child /
 * manager entries. Runs at every `readInstances()` — legacy v1 files
 * converge to v2 on first read post-upgrade with no manual command.
 *
 * - `manager`: reduces to `{ kind: 'manager' }` (URL derived from config).
 * - `local-child`: drops `url`, `issuer`, `createdAt` — resolved live.
 * - `bookmark`: kept as-is.
 * - legacy entries without `kind`: inferred via presence of `url` field
 *   (manager/child-without-url ⇒ local-child; with url ⇒ bookmark). Kept
 *   as-is so the next write goes through `addInstance` with a proper kind.
 */
/**
 * Returns the entry by reference when it's already clean, or a fresh
 * object with manager-owned fields stripped. Callers detect "changed"
 * via reference equality — avoids a full re-serialize per read.
 */
function sanitizeEntry(key: string, entry: InstanceEntry): InstanceEntry {
  if (key === 'manager' || entry.kind === 'manager') {
    const isClean =
      entry.kind === 'manager' &&
      entry.slug === 'manager' &&
      entry.mode === 'local' &&
      entry.url === undefined &&
      entry.issuer === undefined &&
      entry.createdAt === undefined
    return isClean ? entry : { kind: 'manager', slug: 'manager', mode: 'local' }
  }
  if (entry.kind === 'local-child') {
    const hasStale =
      entry.url !== undefined || entry.issuer !== undefined || entry.createdAt !== undefined
    if (!hasStale) return entry
    const { url: _u, issuer: _i, createdAt: _c, ...rest } = entry
    return rest
  }
  return entry
}

function sanitizeStore(store: InstanceStore): { store: InstanceStore; changed: boolean } {
  let changed = false
  const sanitized: InstanceStore = { active: store.active, instances: {} }
  for (const [key, entry] of Object.entries(store.instances)) {
    const clean = sanitizeEntry(key, entry)
    if (clean !== entry) changed = true
    sanitized.instances[key] = clean
  }
  return { store: sanitized, changed }
}

// Process-scoped memo — a single CLI invocation routinely calls
// `readInstances` 4-5 times (resolveKernelUrl, resolveAudience, getActive,
// resolveInstance). The on-disk file is only mutated via `writeInstances`
// (same process), which clears this cache.
let instancesMemo: InstanceStore | null = null

export async function readInstances(config?: AstraleConfig): Promise<InstanceStore> {
  if (instancesMemo) return instancesMemo
  let raw: string
  try {
    raw = await readFile(INSTANCES_PATH, 'utf-8')
  } catch {
    instancesMemo = seed(config)
    return instancesMemo
  }
  let parsed: InstanceStore
  try {
    parsed = InstanceStoreSchema.parse(JSON.parse(raw))
  } catch (e) {
    if (e instanceof z.ZodError) {
      log.warn(`Invalid instances at ${INSTANCES_PATH} — using defaults`)
    }
    instancesMemo = seed(config)
    return instancesMemo
  }
  const { store, changed } = sanitizeStore(parsed)
  instancesMemo = store
  if (changed) {
    // Best-effort migration write — reading never fails if the rewrite does.
    writeInstances(store).catch(() => undefined)
  }
  return store
}

export async function writeInstances(store: InstanceStore): Promise<void> {
  await mkdir(dirname(INSTANCES_PATH), { recursive: true })
  await writeFile(INSTANCES_PATH, JSON.stringify(store, null, 2) + '\n')
  instancesMemo = store
}

// ─── Identifier namespace (§4.7) ────────────────────────────

/**
 * Collect every identifier (key, slug, name) already used in the store.
 * Per §4.7, slug and name share the same CLI namespace.
 */
function collectIdentifiers(store: InstanceStore): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, entry] of Object.entries(store.instances)) {
    out.set(key, `instance key "${key}"`)
    if (entry.slug && !out.has(entry.slug)) {
      out.set(entry.slug, `slug of instance "${key}"`)
    }
    if (entry.name && !out.has(entry.name)) {
      out.set(entry.name, `name of instance "${key}"`)
    }
  }
  return out
}

/** Throws IdentifierCollisionError if `id` already names anything in the store. */
export function assertNoCollision(
  store: InstanceStore,
  identifiers: string[],
  ignoreKey?: string,
): void {
  const existing = collectIdentifiers(store)
  if (ignoreKey) {
    const entry = store.instances[ignoreKey]
    existing.delete(ignoreKey)
    if (entry?.slug) existing.delete(entry.slug)
    if (entry?.name) existing.delete(entry.name)
  }
  for (const id of identifiers) {
    if (!id) continue
    const owner = existing.get(id)
    if (owner) throw new IdentifierCollisionError(id, owner)
  }
}

/**
 * Resolve an identifier (slug OR name OR registry key) to its entry key.
 * Returns null if no match. Per §4.7 uniqueness is guaranteed by construction.
 */
export function resolveInstanceKey(store: InstanceStore, identifier: string): string | null {
  if (store.instances[identifier]) return identifier
  for (const [key, entry] of Object.entries(store.instances)) {
    if (entry.slug === identifier || entry.name === identifier) return key
  }
  return null
}

// ─── Instance management ────────────────────────────────────

export type AddInstanceOpts = {
  url?: string
  slug?: string
  name?: string
  kind?: InstanceKind
  mode?: RegistryMode
  issuer?: string
  defaultIdentity?: string
}

export async function addInstance(key: string, opts: AddInstanceOpts = {}): Promise<InstanceEntry> {
  validateName(key, 'Instance')
  const store = await readInstances()
  if (store.instances[key]) {
    throw new Error(
      `Instance "${key}" already exists. Remove it first with: astrale instance delete ${key}`,
    )
  }
  if (opts.url) validateUrl(opts.url)
  if (opts.slug) validateSlug(opts.slug)
  // Reserved slug check on the registry key itself — `manager` must only be
  // reached through the seed path (never through addInstance/bookmark/create).
  if (RESERVED_SLUGS.has(key)) {
    throw new ReservedSlugError(key)
  }
  assertNoCollision(store, [key, opts.slug, opts.name].filter(Boolean) as string[])

  // `createdAt` only on bookmarks (manager/local-child get it from the
  // manager's graph at read time — persisting here triggers a spurious
  // re-sanitize rewrite on the next `readInstances`).
  const needsCreatedAt = opts.kind === 'bookmark'
  const entry: InstanceEntry = {
    ...opts,
    ...(needsCreatedAt ? { createdAt: new Date().toISOString() } : {}),
  }
  store.instances[key] = entry
  await writeInstances(store)
  return entry
}

export async function removeInstance(key: string): Promise<void> {
  const store = await readInstances()
  if (!store.instances[key]) {
    throw new Error(`Instance "${key}" not found`)
  }
  if (store.active === key) {
    throw new Error(
      `Cannot remove the active instance "${key}". Switch first with: astrale instance use <other>`,
    )
  }
  delete store.instances[key]
  await writeInstances(store)
}

/**
 * Set the active instance. If not in the local store, probe the manager
 * (`KernelInstance/info`) — manager-hosted sub-instances aren't auto-listed
 * locally but should be selectable by name once they exist.
 */
export async function setActive(identifier: string): Promise<string> {
  const store = await readInstances()
  let key = resolveInstanceKey(store, identifier)
  if (!key) {
    validateName(identifier, 'Instance')
    const found = await probeManagerInstance(identifier)
    if (!found) {
      throw new Error(
        `Instance "${identifier}" not found locally or on the manager. ` +
          `Run: astrale instance bookmark ${identifier} --url <url> — or register it via ` +
          `astrale call /manager.astrale.ai/class.KernelInstance/register id=${identifier} graphName=...`,
      )
    }
    assertNoCollision(store, [identifier])
    // Persist a stub. URL stays undefined → resolveKernelUrl synthesizes
    // `http://localhost:<managerPort>/<name>` like the --instance flag.
    store.instances[identifier] = {
      createdAt: new Date().toISOString(),
      slug: identifier,
      kind: 'local-child',
      mode: 'local',
    }
    key = identifier
  }
  store.active = key
  await writeInstances(store)
  return key
}

/**
 * Returns true if the manager knows about an instance by this id.
 * Silent on connection failure (manager down → treat as unknown, the
 * caller surfaces a generic "not found" message).
 */
async function probeManagerInstance(name: string): Promise<boolean> {
  try {
    const config = await readConfig()
    const credential = await resolveCredential({}, config)
    const url = `http://localhost:${config.managerPort}/mngt`
    const session = new ClientSession({
      default: url,
      identity: credential,
      pool: {
        clientFactory: (u) =>
          new KernelClient({
            url: u,
            requestTimeout: 5_000,
            defaultTransport: 'http',
            retry: { maxAttempts: 1 },
          }),
      },
    })
    try {
      await session.call('/manager.astrale.ai/class.KernelInstance/info', { id: name })
      return true
    } finally {
      session.disconnect()
    }
  } catch {
    return false
  }
}

export async function getActive(config?: AstraleConfig): Promise<InstanceEntry & { name: string }> {
  const store = await readInstances(config)
  const entry = store.instances[store.active]
  if (!entry) {
    throw new Error(`Active instance "${store.active}" not found`)
  }
  return { ...entry, name: store.active }
}

export async function getInstance(name: string, config?: AstraleConfig): Promise<InstanceEntry> {
  const store = await readInstances(config)
  const key = resolveInstanceKey(store, name)
  if (!key) {
    throw new Error(
      `Instance "${name}" not found. Run: astrale instance bookmark ${name} --url <url>`,
    )
  }
  return store.instances[key]!
}

// ─── Manager-live snapshot + TTL cache ──────────────────────
//
// `instances.json` no longer persists `url`/`issuer`/`createdAt` for
// local-child entries — those are the manager's source of truth. The CLI
// calls `/manager.astrale.ai/class.KernelInstance/list` once per process
// (memoized here) and also writes a 60s on-disk snapshot at
// `~/.astrale/manager-cache.json`. When the manager is unreachable we
// fall back to the disk snapshot (even if stale) to keep bookmarks and
// `astrale instance list` working offline. Without any cache and no
// manager reachable, `resolveInstance` throws a clear error.

export type ManagerInstance = {
  id: string
  url?: string
  issuer?: string
  status?: string
  health?: unknown
  createdAt?: string
  label?: string
  bootedAt?: string | null
  error?: string | null
}

const ManagerCacheSchema = z.object({
  fetchedAt: z.string(),
  instances: z.array(z.record(z.string(), z.unknown())),
})

const CACHE_TTL_MS = 60_000
let inMemoryCache: { fetchedAt: number; instances: ManagerInstance[] } | null = null

async function readCacheFile(): Promise<{
  fetchedAt: number
  instances: ManagerInstance[]
} | null> {
  try {
    const raw = await readFile(MANAGER_CACHE_PATH, 'utf-8')
    const parsed = ManagerCacheSchema.parse(JSON.parse(raw))
    return {
      fetchedAt: new Date(parsed.fetchedAt).getTime(),
      instances: parsed.instances as ManagerInstance[],
    }
  } catch {
    return null
  }
}

async function writeCacheFile(instances: ManagerInstance[]): Promise<void> {
  await mkdir(dirname(MANAGER_CACHE_PATH), { recursive: true })
  await writeFile(
    MANAGER_CACHE_PATH,
    JSON.stringify({ fetchedAt: new Date().toISOString(), instances }, null, 2) + '\n',
  )
}

/** Invalidate both in-memory and on-disk cache — call after any mutation. */
export async function invalidateManagerCache(): Promise<void> {
  inMemoryCache = null
  await unlink(MANAGER_CACHE_PATH).catch(() => undefined)
}

async function fetchManagerInstancesLive(config: AstraleConfig): Promise<ManagerInstance[]> {
  const credential = await resolveCredential({}, config)
  const session = new ClientSession({
    default: managerUrl(config),
    identity: credential,
    pool: {
      clientFactory: (u) =>
        new KernelClient({
          url: u,
          requestTimeout: 5_000,
          defaultTransport: 'http',
          retry: { maxAttempts: 1 },
        }),
    },
  })
  try {
    const result = (await session.call(
      '/manager.astrale.ai/class.KernelInstance/list',
      {},
    )) as ManagerInstance[]
    return result.map((r) => ({
      ...r,
      // The manager returns `{host, port}` but callers want a URL. Synthesize
      // from `issuer` (set at register) or the manager port + id (direct
      // path-prefix routing).
      url: r.url ?? r.issuer ?? `http://localhost:${config.managerPort}/${r.id}`,
    }))
  } finally {
    session.disconnect()
  }
}

/**
 * Get all instances known to the manager. Cached in-memory for this
 * process; on-disk for 60s across processes. Falls back to any stale
 * cache on manager-down. Throws `MANAGER_UNREACHABLE` if no cache at all.
 */
export async function getManagerInstances(config?: AstraleConfig): Promise<ManagerInstance[]> {
  const cfg = config ?? (await readConfig())
  const now = Date.now()
  if (inMemoryCache && now - inMemoryCache.fetchedAt < CACHE_TTL_MS) {
    return inMemoryCache.instances
  }
  const onDisk = await readCacheFile()
  if (onDisk && now - onDisk.fetchedAt < CACHE_TTL_MS) {
    inMemoryCache = onDisk
    return onDisk.instances
  }
  try {
    const live = await fetchManagerInstancesLive(cfg)
    inMemoryCache = { fetchedAt: now, instances: live }
    writeCacheFile(live).catch(() => undefined)
    return live
  } catch (err) {
    if (onDisk) {
      log.warn(
        `Manager unreachable — using cached instance list (age ${Math.round((now - onDisk.fetchedAt) / 1000)}s)`,
      )
      inMemoryCache = onDisk
      return onDisk.instances
    }
    throw new AstraleError(
      'MANAGER_UNREACHABLE',
      `Cannot reach the manager at ${managerUrl(cfg)} and no cached instance list is available.\n` +
        `  Start it with: astrale start\n` +
        `  Original error: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// ─── Resolution ─────────────────────────────────────────────

/**
 * Unified resolution: merge the local entry (kind, defaultIdentity) with
 * the manager-live or bookmark-stored url/issuer/createdAt. Single source
 * of truth per field — no more drift between `instances.json` and the
 * manager graph.
 *
 * Rules:
 *   - `manager`: url = `managerUrl(config)`, issuer = `config.issuer`.
 *   - `local-child`: url/issuer/createdAt from `getManagerInstances`.
 *     Returns `status: 'orphan-local'` if not found manager-side.
 *   - `bookmark`: url/issuer from the entry itself.
 *
 * Throws if the identifier is unknown locally AND absent from the manager.
 */
export type ResolvedInstance = {
  name: string
  kind: InstanceKind
  url: string
  issuer?: string
  createdAt?: string
  defaultIdentity?: string
  mode?: RegistryMode
  status?: string
}

export async function resolveInstance(
  identifier: string,
  config?: AstraleConfig,
): Promise<ResolvedInstance> {
  const cfg = config ?? (await readConfig())
  const store = await readInstances(cfg)
  const key = resolveInstanceKey(store, identifier)
  const entry = key ? store.instances[key] : undefined

  if (key === 'manager' || entry?.kind === 'manager') {
    return {
      name: 'manager',
      kind: 'manager',
      url: managerUrl(cfg),
      issuer: cfg.issuer,
      mode: 'local',
    }
  }

  if (entry?.kind === 'bookmark') {
    return {
      name: key!,
      kind: 'bookmark',
      url: entry.url!,
      issuer: entry.issuer,
      createdAt: entry.createdAt,
      defaultIdentity: entry.defaultIdentity,
      mode: entry.mode,
    }
  }

  // local-child path (registered locally or manager-only).
  const name = key ?? identifier
  const live = (await getManagerInstances(cfg)).find((i) => i.id === name)
  if (!live) {
    // Neither local nor manager knows this slug.
    if (!entry) {
      throw new AstraleError(
        'INSTANCE_NOT_FOUND',
        `Instance "${identifier}" not found locally or on the manager.\n` +
          `  List: astrale instance list\n` +
          `  Create: astrale instance create --local ${identifier}\n` +
          `  Bookmark: astrale instance bookmark ${identifier} --url <url>`,
      )
    }
    return {
      name,
      kind: 'local-child',
      url: `http://localhost:${cfg.managerPort}/${name}`,
      defaultIdentity: entry.defaultIdentity,
      mode: entry.mode,
      status: 'orphan-local',
    }
  }
  return {
    name,
    kind: 'local-child',
    url: live.url ?? `http://localhost:${cfg.managerPort}/${name}`,
    issuer: live.issuer,
    createdAt: live.createdAt,
    defaultIdentity: entry?.defaultIdentity,
    mode: entry?.mode ?? 'local',
    status: live.status,
  }
}

/**
 * Resolve the kernel HTTP base URL from CLI options and config.
 * Priority: --instance flag > active instance > manager fallback.
 *
 * Thin wrapper over `resolveInstance` — kept for existing callers.
 */
export async function resolveKernelUrl(
  opts: { url?: string; instance?: string },
  config: AstraleConfig,
): Promise<string> {
  if (opts.url) return opts.url
  const identifier = opts.instance ?? (await readInstances(config)).active
  const resolved = await resolveInstance(identifier, config)
  return resolved.url
}

/**
 * Resolve the instance ID for file-path-based operations (e.g., logs).
 * Returns null for manager/bookmark instances (no local journal).
 * Keyed on `kind` now that `entry.url` is no longer persisted for
 * local-children.
 */
export async function resolveInstanceId(
  opts: { instance?: string },
  config?: AstraleConfig,
): Promise<string | null> {
  const store = await readInstances(config)
  if (opts.instance) {
    return resolveInstanceKey(store, opts.instance) ?? opts.instance
  }
  const entry = store.instances[store.active]
  if (!entry || entry.kind === 'bookmark' || entry.kind === 'manager') return null
  return store.active
}
