import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { getDefault } from '../../lib/identity'
import { log } from '../../lib/log'
import { isRawOutput, output } from '../../lib/output'

export default {
  name: 'whoami',
  description: 'Show the current default identity',
  options: [
    { flags: '--raw', description: 'Output raw JSON' },
    { flags: '--json', description: 'Alias for --raw' },
  ],
  action: async (opts: { raw?: boolean; json?: boolean }) => {
    try {
      const isRaw = isRawOutput(opts)
      const identity = await getDefault()

      if (isRaw) {
        output({ name: identity.name, subject: identity.subject }, opts)
        return
      }

      console.log(`${chalk.bold(identity.name)} (subject: ${identity.subject})`)
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
} satisfies CommandDefinition
