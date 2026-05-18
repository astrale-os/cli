import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { cloudflaredAdapter } from '../../adapters/tunnel-cloudflared'
import { fatal, log } from '../../lib/log'
import { findTunnel, readTunnels } from '../../lib/tunnels'

export default {
  name: 'status',
  description: 'Show tunnel status + DNS preflight',
  arguments: [{ name: 'name', description: 'Tunnel name or id', required: false }],
  action: async (name?: string) => {
    try {
      const store = await readTunnels()
      const entries = name
        ? [findTunnel(store, name)].filter((e): e is NonNullable<typeof e> => !!e)
        : Object.values(store.tunnels)

      if (entries.length === 0) {
        log.dim(name ? `  Tunnel "${name}" not registered.` : '  No tunnels registered.')
        return
      }

      for (const entry of entries) {
        const status = await cloudflaredAdapter.status(entry.id)
        console.log(`${chalk.bold(entry.name)} (${entry.id})`)
        log.dim(`  hostname: ${entry.hostname}`)
        log.dim(`  status:   ${status}`)
        if (entry.boundInstance) log.dim(`  bound to: ${entry.boundInstance}`)
        try {
          await cloudflaredAdapter.dnsPreflight(entry.hostname)
          log.success('  DNS resolves')
        } catch (e) {
          log.warn(`  ${(e as Error).message}`)
        }
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
