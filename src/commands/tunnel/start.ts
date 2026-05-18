import type { CommandDefinition } from '../../command'

import { cloudflaredAdapter } from '../../adapters/tunnel-cloudflared'
import { fatal, log } from '../../lib/log'
import { findTunnel, readTunnels } from '../../lib/tunnels'

export default {
  name: 'start',
  description: 'Start a tunnel in the background',
  arguments: [{ name: 'name', description: 'Tunnel name or id', required: true }],
  action: async (name: string) => {
    try {
      const store = await readTunnels()
      const entry = findTunnel(store, name)
      if (!entry)
        fatal(new Error(`Tunnel "${name}" not registered. Run: astrale tunnel setup ${name}`))
      const { pid } = await cloudflaredAdapter.start(entry!.id)
      log.success(`Started tunnel "${entry!.name}" (pid=${pid})`)
      log.dim(`  hostname: ${entry!.hostname}`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
