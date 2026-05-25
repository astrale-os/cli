import type { CommandDefinition } from '../../command'

import { resolveTunnelAdapter } from '../../adapters/tunnel'
import { fatal, log } from '../../lib/log'
import { findTunnel, readTunnels } from '../../lib/tunnels'

export default {
  name: 'stop',
  description: 'Stop a running tunnel (idempotent)',
  arguments: [{ name: 'name', description: 'Tunnel name or id', required: true }],
  action: async (name: string) => {
    try {
      const store = await readTunnels()
      const entry = findTunnel(store, name)
      if (!entry) {
        log.warn(`Tunnel "${name}" not registered — nothing to stop.`)
        return
      }
      await resolveTunnelAdapter(entry.adapter).stop(entry.id)
      log.success(`Stopped tunnel "${entry.name}"`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
