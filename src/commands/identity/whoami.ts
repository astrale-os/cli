import chalk from 'chalk'

import type { CommandDefinition } from '../../program/index'

import { getDefault } from '../../identity/index'
import { fatal } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/output'

type WhoamiResult = {
  name: string
  subject: string
}

export default {
  name: 'whoami',
  description: 'Show the current default identity',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: RawOutputOpts) => {
    try {
      const identity = await getDefault()
      const result: WhoamiResult = {
        name: identity.name,
        subject: identity.subject,
      }
      if (isMachine(opts)) {
        output(result, opts)
        return
      }
      console.log(`${chalk.bold(result.name)} (subject: ${result.subject})`)
    } catch (e) {
      fatal(e, opts)
    }
  },
} satisfies CommandDefinition
