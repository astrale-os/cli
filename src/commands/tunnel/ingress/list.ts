import type { CommandDefinition } from '../../../command'

import { fatal, log } from '../../../lib/log'
import { addIngressHint, readTunnels, requireTunnel } from '../../../lib/tunnels'

export default {
  name: 'list',
  description: 'Show the ingress rules attached to a tunnel',
  afterHelpText: `
Examples:
  $ astrale tunnel ingress list my-tunnel
`,
  arguments: [{ name: 'tunnel', description: 'Tunnel name or id', required: true }],
  action: async (tunnel: string) => {
    try {
      const entry = requireTunnel(await readTunnels(), tunnel)
      log.dim(`Tunnel "${entry.name}" (${entry.id})`)
      if (entry.ingress.length === 0) {
        log.info('  no ingress — every request returns 404 until you add a route')
        log.dim(`  Add one with: ${addIngressHint(entry.name)}`)
        return
      }
      for (const [i, rule] of entry.ingress.entries()) {
        const suffix = rule.path ? ` (path: ${rule.path})` : ''
        log.info(`  ${i + 1}. ${rule.hostname} → ${rule.service}${suffix}`)
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
