import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { getActive } from '../../lib/instance'
import { log } from '../../lib/log'
import { RAW_OUTPUT_OPTIONS, isMachine, output, type RawOutputOpts } from '../../lib/output'

export default {
  name: 'active',
  description: 'Show the currently active instance',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: RawOutputOpts) => {
    try {
      const isRaw = isMachine(opts)
      const active = await getActive()
      const { name } = active
      const url = active.url ?? null
      const createdAt = active.createdAt ?? null

      if (isRaw) {
        output({ name, url, createdAt }, opts)
        return
      }

      console.log(`${chalk.bold(name)} (${url ?? 'local'})`)
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
} satisfies CommandDefinition
