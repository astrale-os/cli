import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { cloudflaredAdapter } from '../../adapters/tunnel-cloudflared'
import { fatal, log } from '../../lib/log'
import { RAW_OUTPUT_OPTIONS, isRawOutput, output, type RawOutputOpts } from '../../lib/output'
import { readTunnels } from '../../lib/tunnels'

export default {
  name: 'list',
  description: 'List registered tunnels (§12)',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: RawOutputOpts) => {
    try {
      const store = await readTunnels()
      const entries = Object.values(store.tunnels)
      const withStatus = await Promise.all(
        entries.map(async (e) => ({
          ...e,
          status: await cloudflaredAdapter.status(e.id).catch(() => 'unknown' as const),
        })),
      )

      if (isRawOutput(opts)) {
        output({ tunnels: withStatus }, opts)
        return
      }

      if (withStatus.length === 0) {
        log.dim('  No tunnels. Run: astrale tunnel setup <name>')
        return
      }

      for (const e of withStatus) {
        const statusColor = e.status === 'running' ? chalk.green : chalk.dim
        const bound = e.boundInstance ? chalk.dim(` → ${e.boundInstance}`) : ''
        console.log(
          `  ${chalk.bold(e.name)} ${chalk.dim(`(${e.id.slice(0, 8)})`)} ${e.hostname} ${statusColor(`[${e.status}]`)}${bound}`,
        )
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
