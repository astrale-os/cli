import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { AstraleConfig } from './config'

import { INSTANCES_PATH } from './paths'

// ─── Types ──────────────────────────────────────────────────

export type InstanceEntry = {
  url?: string // remote instances have a URL; local ones don't (resolved via manager port)
  createdAt: string
}

export type InstanceStore = {
  active: string
  instances: Record<string, InstanceEntry>
}

// ─── Seed ───────────────────────────────────────────────────

function seed(config?: AstraleConfig): InstanceStore {
  const port = config?.managerPort ?? 4400
  return {
    active: 'manager',
    instances: {
      manager: { url: `ws://localhost:${port}/mngt/ws`, createdAt: new Date().toISOString() },
    },
  }
}

// ─── Persistence ────────────────────────────────────────────

export async function readInstances(config?: AstraleConfig): Promise<InstanceStore> {
  try {
    const raw = await readFile(INSTANCES_PATH, 'utf-8')
    return { ...seed(config), ...JSON.parse(raw) }
  } catch {
    return seed(config)
  }
}

export async function writeInstances(store: InstanceStore): Promise<void> {
  await mkdir(dirname(INSTANCES_PATH), { recursive: true })
  await writeFile(INSTANCES_PATH, JSON.stringify(store, null, 2) + '\n')
}

// ─── Instance management ────────────────────────────────────

export async function addInstance(name: string, opts: { url?: string }): Promise<InstanceEntry> {
  const store = await readInstances()
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
 * Set the active instance. Auto-registers as local if not known.
 */
export async function setActive(name: string): Promise<void> {
  const store = await readInstances()
  if (!store.instances[name]) {
    // Auto-register as local instance
    store.instances[name] = { createdAt: new Date().toISOString() }
  }
  store.active = name
  await writeInstances(store)
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
 * Resolve the WS URL from CLI options and config.
 * Priority: --instance flag > active instance > manager fallback
 */
export async function resolveWsUrl(
  opts: { instance?: string },
  config: AstraleConfig,
): Promise<string> {
  if (opts.instance) {
    const store = await readInstances(config)
    const entry = store.instances[opts.instance]
    if (entry?.url) return entry.url
    return `ws://localhost:${config.managerPort}/${opts.instance}/ws`
  }

  const active = await getActive(config)
  if (active.url) return active.url
  return `ws://localhost:${config.managerPort}/${active.name}/ws`
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
