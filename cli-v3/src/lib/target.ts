import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { TARGETS_PATH } from './paths'
import type { AstraleConfig } from './config'

export type Target = { url?: string; instance?: string; createdAt: string }
export type TargetStore = { default: string; targets: Record<string, Target> }

function seed(config?: AstraleConfig): TargetStore {
  const port = config?.managerPort ?? 4400
  return {
    default: 'manager',
    targets: {
      manager: { url: `ws://localhost:${port}/mngt/ws`, createdAt: new Date().toISOString() },
    },
  }
}

export async function readTargets(config?: AstraleConfig): Promise<TargetStore> {
  try {
    const raw = await readFile(TARGETS_PATH, 'utf-8')
    return { ...seed(config), ...JSON.parse(raw) }
  } catch {
    return seed(config)
  }
}

export async function writeTargets(store: TargetStore): Promise<void> {
  await mkdir(dirname(TARGETS_PATH), { recursive: true })
  await writeFile(TARGETS_PATH, JSON.stringify(store, null, 2) + '\n')
}

export async function createTarget(
  name: string,
  target: { url?: string; instance?: string },
): Promise<Target> {
  const store = await readTargets()
  if (store.targets[name]) {
    throw new Error(`Target "${name}" already exists`)
  }
  if (!target.url && !target.instance) {
    throw new Error('Provide --url or --instance')
  }
  const entry: Target = { ...target, createdAt: new Date().toISOString() }
  store.targets[name] = entry
  await writeTargets(store)
  return entry
}

export async function deleteTarget(name: string): Promise<void> {
  const store = await readTargets()
  if (!store.targets[name]) {
    throw new Error(`Target "${name}" not found`)
  }
  if (store.default === name) {
    throw new Error(`Cannot delete the default target "${name}". Switch default first with: astrale target use <other>`)
  }
  delete store.targets[name]
  await writeTargets(store)
}

export async function setDefaultTarget(name: string): Promise<void> {
  const store = await readTargets()
  if (!store.targets[name]) {
    throw new Error(`Target "${name}" not found`)
  }
  store.default = name
  await writeTargets(store)
}

export async function getDefaultTarget(config?: AstraleConfig): Promise<Target & { name: string }> {
  const store = await readTargets(config)
  const target = store.targets[store.default]
  if (!target) {
    throw new Error(`Default target "${store.default}" not found`)
  }
  return { ...target, name: store.default }
}

export async function getTarget(name: string, config?: AstraleConfig): Promise<Target> {
  const store = await readTargets(config)
  const target = store.targets[name]
  if (!target) {
    throw new Error(`Target "${name}" not found. Run: astrale target create ${name} --url <ws-url>`)
  }
  return target
}

/**
 * Resolve the WS URL from CLI options and config.
 * Priority: --remote > --instance > default target > manager fallback
 */
export async function resolveWsUrl(
  opts: { remote?: string; instance?: string },
  config: AstraleConfig,
): Promise<string> {
  if (opts.remote) {
    if (opts.remote.startsWith('ws://') || opts.remote.startsWith('wss://')) {
      return opts.remote
    }
    const target = await getTarget(opts.remote, config)
    if (target.url) return target.url
    if (target.instance) return `ws://localhost:${config.managerPort}/${target.instance}/ws`
  }

  if (opts.instance) {
    return `ws://localhost:${config.managerPort}/${opts.instance}/ws`
  }

  const defaultTarget = await getDefaultTarget(config)
  if (defaultTarget.url) return defaultTarget.url
  if (defaultTarget.instance) return `ws://localhost:${config.managerPort}/${defaultTarget.instance}/ws`

  return `ws://localhost:${config.managerPort}/mngt/ws`
}
