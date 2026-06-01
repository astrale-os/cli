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
}

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

function seed(): InstanceStore {
  return { active: '', instances: {} }
}

function sanitizeStore(store: InstanceStore): { store: InstanceStore; changed: boolean } {
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
    const next: InstanceEntry = { ...entry, kind: 'bookmark' }
    if (next !== entry || entry.kind !== 'bookmark') changed = true
    instances[key] = next
  }

  const active = instances[store.active] ? store.active : (Object.keys(instances)[0] ?? '')
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

function collectIdentifiers(store: InstanceStore): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, entry] of Object.entries(store.instances)) {
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
  validateUrl(opts.url)

  const store = await readInstances()
  if (store.instances[key]) {
    throw new Error(
      `Instance "${key}" already exists. Remove it first with: astrale instance forget ${key}`,
    )
  }
  assertNoCollision(store, [key, opts.slug, opts.name].filter(Boolean) as string[])

  const entry: InstanceEntry = {
    ...opts,
    kind: 'bookmark',
    createdAt: new Date().toISOString(),
  }
  store.instances[key] = entry
  if (!store.active) store.active = key
  await writeInstances(store)
  return entry
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

export async function getActive(config?: AstraleConfig): Promise<InstanceEntry & { name: string }> {
  const store = await readInstances(config)
  if (!store.active) {
    throw new Error('No active instance. Run: astrale instance bookmark <name> --url <url> --use')
  }
  const entry = store.instances[store.active]
  if (!entry?.url) throw new Error(`Active instance "${store.active}" is not a valid bookmark`)
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
    url: entry.url,
    issuer: entry.issuer,
    createdAt: entry.createdAt,
    defaultIdentity: entry.defaultIdentity,
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
