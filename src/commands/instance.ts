import { KernelWSClient } from '@astrale-os/kernel-client-ws'
import chalk from 'chalk'

import { readConfig } from '../lib/config'
import { getDefault } from '../lib/identity'
import { readInstances, addInstance, removeInstance, getActive } from '../lib/instance'
import { signAs } from '../lib/keys'
import { log } from '../lib/log'
import { KEYS_DIR } from '../lib/paths'

type ManagerInstance = { id: string; status: string; label?: string }

async function discoverLocalInstances(): Promise<ManagerInstance[]> {
  try {
    const config = await readConfig()
    const identity = await getDefault()
    const credential = await signAs(identity.subject, KEYS_DIR, { issuer: config.issuer })
    const wsUrl = `ws://localhost:${config.managerPort}/mngt/ws`

    const client = new KernelWSClient({
      wsUrl,
      autoConnect: false,
      reconnect: false,
      maxRetries: 0,
      requestTimeout: 5_000,
    })

    await client.connect()
    const instances = (await client.call(
      '/manager.astrale.ai/KernelInstance/list',
      {},
      credential,
    )) as ManagerInstance[]
    await client.close()
    return instances
  } catch {
    return []
  }
}

export async function instanceListCommand(): Promise<void> {
  const store = await readInstances()
  const discovered = await discoverLocalInstances()

  // Merge: discovered local instances that aren't in the store
  const merged = new Map<
    string,
    { url?: string; status?: string; source: 'store' | 'discovered' }
  >()

  for (const [name, entry] of Object.entries(store.instances)) {
    merged.set(name, { url: entry.url, source: 'store' })
  }

  for (const inst of discovered) {
    const existing = merged.get(inst.id)
    if (existing) {
      existing.status = inst.status
    } else {
      merged.set(inst.id, { status: inst.status, source: 'discovered' })
    }
  }

  if (merged.size === 0) {
    log.dim('  No instances. Run: astrale instance add <name>')
    return
  }

  for (const [name, info] of merged) {
    const isActive = name === store.active
    const marker = isActive ? chalk.green(' *') : ''
    const status = info.status ? chalk.dim(` [${info.status}]`) : ''

    let detail: string
    if (info.url) {
      detail = chalk.dim(` (${info.url})`)
    } else {
      detail = chalk.dim(' (local)')
    }

    console.log(`  ${chalk.bold(name)}${detail}${status}${marker}`)
  }
}

export async function instanceAddCommand(name: string, opts: { url?: string }): Promise<void> {
  try {
    const entry = await addInstance(name, opts)
    if (entry.url) {
      log.success(`Added instance "${name}" (${entry.url})`)
    } else {
      log.success(`Added instance "${name}" (local)`)
    }
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

export async function instanceRemoveCommand(name: string): Promise<void> {
  try {
    await removeInstance(name)
    log.success(`Removed instance "${name}"`)
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

export async function instanceActiveCommand(): Promise<void> {
  try {
    const active = await getActive()
    const detail = active.url ?? 'local'
    console.log(`${chalk.bold(active.name)} (${detail})`)
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
