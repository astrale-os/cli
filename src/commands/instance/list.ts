import { KernelClient, type FnMap } from '@astrale-os/kernel-client'
import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { resolveCredential } from '../../kernel/auth'
import { readConfig } from '../../lib/config'
import { readInstances } from '../../lib/instance'
import { log } from '../../lib/log'
import { isRawOutput, output } from '../../lib/output'

type ManagerInstance = { id: string; status: string; label?: string }

async function discoverLocalInstances(): Promise<{
  instances: ManagerInstance[]
  error?: Error
}> {
  let client: KernelClient<FnMap> | null = null
  try {
    const config = await readConfig()
    const credential = await resolveCredential({}, config)
    const url = `http://localhost:${config.managerPort}/mngt`

    client = new KernelClient<FnMap>({ url, requestTimeout: 5_000 })

    const instances = (await client.call(
      '/manager.astrale.ai/class.KernelInstance/list',
      {},
      credential,
    )) as ManagerInstance[]
    return { instances }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    // A down manager is expected — silent fallback. Anything else is a real
    // error and should be surfaced to the user, not swallowed.
    if (err.name === 'ConnectionError' || err.name === 'TimeoutError') {
      return { instances: [] }
    }
    return { instances: [], error: err }
  } finally {
    client?.disconnect()
  }
}

export default {
  name: 'list',
  description: 'List all registered instances',
  options: [
    { flags: '--raw', description: 'Output raw JSON' },
    { flags: '--json', description: 'Alias for --raw' },
  ],
  action: async (opts: { raw?: boolean; json?: boolean }) => {
    const isRaw = isRawOutput(opts)
    const store = await readInstances()
    const { instances: discovered, error: discoveryError } = await discoverLocalInstances()

    if (discoveryError && !isRaw) {
      log.warn(`Could not discover instances from manager: ${discoveryError.message}`)
    }

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

    if (isRaw) {
      const items = Array.from(merged.entries()).map(([name, info]) => ({
        name,
        url: info.url ?? null,
        status: info.status ?? 'unknown',
        active: name === store.active,
      }))
      output({ active: store.active, instances: items }, opts)
      return
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
  },
} satisfies CommandDefinition
