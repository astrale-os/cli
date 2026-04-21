import { KernelClient } from '@astrale-os/kernel-client'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import type { AstraleConfig } from './config'

import { resolveCredential } from '../kernel/auth'
import { readConfig } from './config'
import { log } from './log'
import { INSTANCES_PATH } from './paths'

// ─── Schemas ─────────────────────────────────────────────────

export const InstanceEntrySchema = z.object({
  url: z.string().optional(),
  createdAt: z.string(),
})

export const InstanceStoreSchema = z.object({
  active: z.string(),
  instances: z.record(z.string(), InstanceEntrySchema),
})

export type InstanceEntry = z.infer<typeof InstanceEntrySchema>
export type InstanceStore = z.infer<typeof InstanceStoreSchema>

// ─── Validation ─────────────────────────────────────────────

const NAME_RE = /^[a-zA-Z0-9_.-]+$/

export function validateName(name: string, entity: string): void {
  if (!name || !NAME_RE.test(name)) {
    throw new Error(
      `Invalid ${entity.toLowerCase()} name "${name}" — must be non-empty and contain only letters, digits, hyphens, underscores, and dots`,
    )
  }
}

function validateUrl(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('not http(s)')
    }
  } catch {
    throw new Error(`Invalid URL "${url}" — expected a valid http:// or https:// URL`)
  }
}

// ─── Seed ───────────────────────────────────────────────────

function seed(config?: AstraleConfig): InstanceStore {
  const port = config?.managerPort ?? 4400
  return {
    active: 'manager',
    instances: {
      manager: { url: `http://localhost:${port}/mngt`, createdAt: new Date().toISOString() },
    },
  }
}

// ─── Persistence ────────────────────────────────────────────

export async function readInstances(config?: AstraleConfig): Promise<InstanceStore> {
  try {
    const raw = await readFile(INSTANCES_PATH, 'utf-8')
    return InstanceStoreSchema.parse(JSON.parse(raw))
  } catch (e) {
    if (e instanceof z.ZodError) {
      log.warn(`Invalid instances at ${INSTANCES_PATH} — using defaults`)
    }
    return seed(config)
  }
}

export async function writeInstances(store: InstanceStore): Promise<void> {
  await mkdir(dirname(INSTANCES_PATH), { recursive: true })
  await writeFile(INSTANCES_PATH, JSON.stringify(store, null, 2) + '\n')
}

// ─── Instance management ────────────────────────────────────

export async function addInstance(name: string, opts: { url?: string }): Promise<InstanceEntry> {
  validateName(name, 'Instance')
  const store = await readInstances()
  if (store.instances[name]) {
    throw new Error(
      `Instance "${name}" already exists. Remove it first with: astrale instance remove ${name}`,
    )
  }
  if (opts.url) validateUrl(opts.url)
  const entry: InstanceEntry = { ...opts, createdAt: new Date().toISOString() }
  store.instances[name] = entry
  await writeInstances(store)
  return entry
}

export async function removeInstance(name: string): Promise<void> {
  const store = await readInstances()
  if (!store.instances[name]) {
    throw new Error(`Instance "${name}" not found`)
  }
  if (store.active === name) {
    throw new Error(
      `Cannot remove the active instance "${name}". Switch first with: astrale use <other>`,
    )
  }
  delete store.instances[name]
  await writeInstances(store)
}

/**
 * Set the active instance. If not in the local store, probe the manager
 * (`KernelInstance/info`) — manager-hosted sub-instances aren't auto-listed
 * locally but should be selectable by name once they exist.
 */
export async function setActive(name: string): Promise<void> {
  validateName(name, 'Instance')
  const store = await readInstances()
  if (!store.instances[name]) {
    const found = await probeManagerInstance(name)
    if (!found) {
      throw new Error(
        `Instance "${name}" not found locally or on the manager. ` +
          `Run: astrale instance add ${name} — or register it via ` +
          `astrale call /manager.astrale.ai/class.KernelInstance/register id=${name} graphName=...`,
      )
    }
    // Persist a stub. URL stays undefined → resolveKernelUrl synthesizes
    // `http://localhost:<managerPort>/mgt/<name>` like the --instance flag.
    store.instances[name] = { createdAt: new Date().toISOString() }
  }
  store.active = name
  await writeInstances(store)
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
    const client = new KernelClient({
      url,
      requestTimeout: 5_000,
      defaultTransport: 'http',
      retry: { maxAttempts: 1 },
    })
    try {
      await client.call('/manager.astrale.ai/class.KernelInstance/info', { id: name }, credential)
      return true
    } finally {
      client.disconnect()
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
  const entry = store.instances[name]
  if (!entry) {
    throw new Error(`Instance "${name}" not found. Run: astrale instance add ${name}`)
  }
  return entry
}

// ─── Resolution ─────────────────────────────────────────────

/**
 * Resolve the kernel HTTP base URL from CLI options and config.
 * Priority: --instance flag > active instance > manager fallback.
 *
 * The new kernel client takes an HTTP URL and lazily upgrades to WS as
 * needed, so we no longer publish a `ws://…/ws` endpoint.
 */
export async function resolveKernelUrl(
  opts: { url?: string; instance?: string },
  config: AstraleConfig,
): Promise<string> {
  if (opts.url) return opts.url

  if (opts.instance) {
    const store = await readInstances(config)
    const entry = store.instances[opts.instance]
    if (entry?.url) return entry.url
    return `http://localhost:${config.managerPort}/mgt/${opts.instance}`
  }

  const active = await getActive(config)
  if (active.url) return active.url
  return `http://localhost:${config.managerPort}/mgt/${active.name}`
}

/**
 * Resolve the instance ID for file-path-based operations (e.g., logs).
 * Returns null for manager/remote instances (no local journal).
 */
export async function resolveInstanceId(
  opts: { instance?: string },
  config?: AstraleConfig,
): Promise<string | null> {
  if (opts.instance) return opts.instance

  const store = await readInstances(config)
  const entry = store.instances[store.active]
  if (!entry) return null
  // Only return instance ID for local instances (no url)
  if (!entry.url) return store.active
  return null
}
