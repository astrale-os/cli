import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { getActive } from '../../lib/instance'
import { log } from '../../lib/log'
import { isRawOutput, output } from '../../lib/output'

export default {
  name: 'active',
  description: 'Show the currently active instance',
  options: [
    { flags: '--raw', description: 'Output raw JSON' },
    { flags: '--json', description: 'Alias for --raw' },
  ],
  action: async (opts: { raw?: boolean; json?: boolean }) => {
    try {
      const isRaw = isRawOutput(opts)
      const active = await getActive()

      if (isRaw) {
        output({ name: active.name, url: active.url ?? null, createdAt: active.createdAt }, opts)
        return
      }

      const detail = active.url ?? 'local'
      console.log(`${chalk.bold(active.name)} (${detail})`)
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
} satisfies CommandDefinition
