import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import { log } from './log'
import { TUNNELS_PATH } from './paths'

export const TunnelEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  adapter: z.string(),
  hostname: z.string(),
  boundInstance: z.string().optional(),
  createdAt: z.string(),
})

export const TunnelStoreSchema = z.object({
  tunnels: z.record(z.string(), TunnelEntrySchema),
})

export type TunnelEntry = z.infer<typeof TunnelEntrySchema>
export type TunnelStore = z.infer<typeof TunnelStoreSchema>

function seed(): TunnelStore {
  return { tunnels: {} }
}

export async function readTunnels(): Promise<TunnelStore> {
  try {
    const raw = await readFile(TUNNELS_PATH, 'utf-8')
    return TunnelStoreSchema.parse(JSON.parse(raw))
  } catch (e) {
    if (e instanceof z.ZodError) {
      log.warn(`Invalid tunnels at ${TUNNELS_PATH} — using defaults`)
    }
    return seed()
  }
}

export async function writeTunnels(store: TunnelStore): Promise<void> {
  await mkdir(dirname(TUNNELS_PATH), { recursive: true })
  await writeFile(TUNNELS_PATH, JSON.stringify(store, null, 2) + '\n')
}

export async function addTunnel(entry: TunnelEntry): Promise<void> {
  const store = await readTunnels()
  if (store.tunnels[entry.name]) {
    throw new Error(`Tunnel "${entry.name}" already registered`)
  }
  store.tunnels[entry.name] = entry
  await writeTunnels(store)
}

export async function removeTunnel(name: string): Promise<void> {
  const store = await readTunnels()
  if (!store.tunnels[name]) return
  delete store.tunnels[name]
  await writeTunnels(store)
}

/** Resolve a tunnel by name OR id. */
export function findTunnel(store: TunnelStore, identifier: string): TunnelEntry | undefined {
  if (store.tunnels[identifier]) return store.tunnels[identifier]
  for (const entry of Object.values(store.tunnels)) {
    if (entry.id === identifier) return entry
  }
  return undefined
}

export async function bindTunnel(nameOrId: string, instanceKey: string): Promise<void> {
  const store = await readTunnels()
  const entry = findTunnel(store, nameOrId)
  if (!entry) throw new Error(`Tunnel "${nameOrId}" not found`)
  if (entry.boundInstance && entry.boundInstance !== instanceKey) {
    throw new Error(
      `Tunnel "${entry.name}" already bound to instance "${entry.boundInstance}" — tunnels are 1:1 (§12)`,
    )
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
