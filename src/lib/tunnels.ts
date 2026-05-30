import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import type { IngressRule } from '../ports/tunnel'

import {
  IdentifierCollisionError,
  TunnelNotFoundError,
  TunnelRegistryInvalidError,
} from '../errors'
import { TUNNELS_PATH } from './paths'
import { isHttpUrl } from './validation'

/**
 * One ingress rule: a public hostname forwarded to a local service URL.
 * Wildcards (`*.foo.bar`) are valid hostnames — cloudflared matches them
 * literally. `service` is http(s) only (astrale's contract). `path` is
 * optional (cloudflared default = match all paths) but never empty.
 *
 * Annotated as `z.ZodType<IngressRule>` so the schema and the port's neutral
 * `IngressRule` (re-exported below as the single canonical type) cannot drift:
 * add/remove a field on either side and this stops type-checking.
 */
export const IngressRuleSchema: z.ZodType<IngressRule> = z.object({
  hostname: z.string().min(1),
  service: z.string().min(1).refine(isHttpUrl, { message: 'service must be a valid http(s) URL' }),
  path: z.string().min(1).optional(),
})

export const TunnelEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  adapter: z.string(),
  hostname: z.string(),
  boundInstance: z.string().optional(),
  createdAt: z.string(),
  ingress: z.array(IngressRuleSchema).optional().default([]),
})

export const TunnelStoreSchema = z.object({
  tunnels: z.record(z.string(), TunnelEntrySchema),
})

export type { IngressRule }
export type TunnelEntry = z.infer<typeof TunnelEntrySchema>
export type TunnelStore = z.infer<typeof TunnelStoreSchema>

function seed(): TunnelStore {
  return { tunnels: {} }
}

/**
 * Pure parser — throws a plain `Error` on parse/schema failure so callers
 * can wrap with their own context (path, etc.). Use `readTunnels` for the
 * I/O+typed-error variant.
 */
export function parseTunnelStore(raw: string): TunnelStore {
  return TunnelStoreSchema.parse(JSON.parse(raw))
}

export async function readTunnels(): Promise<TunnelStore> {
  let raw: string
  try {
    raw = await readFile(TUNNELS_PATH, 'utf-8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return seed()
    throw e
  }
  try {
    return parseTunnelStore(raw)
  } catch (e) {
    throw new TunnelRegistryInvalidError(TUNNELS_PATH, e instanceof Error ? e.message : String(e))
  }
}

export async function writeTunnels(store: TunnelStore): Promise<void> {
  // Validate before persisting so the file on disk always re-reads cleanly:
  // an invalid in-memory store (e.g. a non-http(s) service) fails loudly here
  // rather than silently persisting and bricking the next readTunnels().
  TunnelStoreSchema.parse(store)
  await mkdir(dirname(TUNNELS_PATH), { recursive: true })
  await writeFile(TUNNELS_PATH, JSON.stringify(store, null, 2) + '\n')
}

export async function addTunnel(entry: TunnelEntry): Promise<void> {
  const store = await readTunnels()
  if (store.tunnels[entry.name]) {
    throw new IdentifierCollisionError(entry.name, 'tunnel')
  }
  store.tunnels[entry.name] = entry
  await writeTunnels(store)
}

/** Resolve a tunnel by name OR id. */
export function findTunnel(store: TunnelStore, nameOrId: string): TunnelEntry | undefined {
  if (store.tunnels[nameOrId]) return store.tunnels[nameOrId]
  for (const entry of Object.values(store.tunnels)) {
    if (entry.id === nameOrId) return entry
  }
  return undefined
}

/** Throwing variant — for command sites that always need an entry. */
export function requireTunnel(store: TunnelStore, nameOrId: string): TunnelEntry {
  const entry = findTunnel(store, nameOrId)
  if (!entry) throw new TunnelNotFoundError(nameOrId)
  return entry
}

/**
 * Pure in-place variant of `addIngressRule`. Mutates `store` (appends the
 * rule unless an identical hostname+service+path triple already exists) and
 * returns the duplicate flag. Exported for testing.
 *
 * Cloudflared matches ingress top-to-bottom, so duplicates are dead routes
 * that pollute `tunnel ingress list` without any effect — hence the skip.
 */
export function appendIngressRule(
  store: TunnelStore,
  nameOrId: string,
  rule: IngressRule,
): { entry: TunnelEntry; duplicate: boolean } {
  const entry = requireTunnel(store, nameOrId)
  const duplicate = entry.ingress.some(
    (r) => r.hostname === rule.hostname && r.service === rule.service && r.path === rule.path,
  )
  if (!duplicate) entry.ingress.push(rule)
  return { entry, duplicate }
}

export async function addIngressRule(
  nameOrId: string,
  rule: IngressRule,
): Promise<{ entry: TunnelEntry; duplicate: boolean }> {
  const store = await readTunnels()
  const result = appendIngressRule(store, nameOrId, rule)
  if (!result.duplicate) await writeTunnels(store)
  return result
}

export async function bindTunnel(nameOrId: string, instanceKey: string): Promise<void> {
  const store = await readTunnels()
  const entry = requireTunnel(store, nameOrId)
  if (entry.boundInstance && entry.boundInstance !== instanceKey) {
    // §12 — tunnels are 1:1 with instances.
    throw new Error(`Tunnel "${entry.name}" already bound to instance "${entry.boundInstance}"`)
  }
  entry.boundInstance = instanceKey
  await writeTunnels(store)
}

export async function unbindTunnel(nameOrId: string): Promise<void> {
  const store = await readTunnels()
  const entry = findTunnel(store, nameOrId)
  if (!entry) return
  delete entry.boundInstance
  await writeTunnels(store)
}

/**
 * Best-effort detach of every tunnel bound to `instanceKey`. A broken or
 * unreadable registry must never block instance deletion, so failures are
 * captured into `error` rather than thrown. `read`/`unbind` are injectable
 * for testing. Returns the detached names and any swallowed error message.
 */
export async function detachInstanceTunnels(
  instanceKey: string,
  read: () => Promise<TunnelStore> = readTunnels,
  unbind: (nameOrId: string) => Promise<void> = unbindTunnel,
): Promise<{ detached: string[]; error?: string }> {
  try {
    const store = await read()
    const detached: string[] = []
    for (const t of Object.values(store.tunnels)) {
      if (t.boundInstance === instanceKey) {
        await unbind(t.name)
        detached.push(t.name)
      }
    }
    return { detached }
  } catch (e) {
    return { detached: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Canonical "no ingress" hint — `astrale tunnel ingress add <name>`. Single
 * source so the command syntax doesn't drift between setup/status/list/adopt.
 */
export function addIngressHint(name: string): string {
  return `astrale tunnel ingress add ${name} --hostname <h> --service <url>`
}
