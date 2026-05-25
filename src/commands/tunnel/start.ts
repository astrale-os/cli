import type { CommandDefinition } from '../../command'

import { resolveTunnelAdapter } from '../../adapters/tunnel'
import { fatal, log } from '../../lib/log'
import { readTunnels, requireTunnel } from '../../lib/tunnels'

export default {
  name: 'start',
  description: 'Start a tunnel in the background',
  arguments: [{ name: 'name', description: 'Tunnel name or id', required: true }],
  action: async (name: string) => {
    try {
      const entry = requireTunnel(await readTunnels(), name)
      const adapter = resolveTunnelAdapter(entry.adapter)
      const { pid } = await adapter.start({
        id: entry.id,
        hostname: entry.hostname,
        ingress: entry.ingress,
      })
      log.success(`Started tunnel "${entry.name}" (pid=${pid})`)
      log.dim(`  hostname: ${entry.hostname}`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
