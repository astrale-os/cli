import type { CommandDefinition } from '../../program/index'

import { setDefault } from '../../identity/index'
import { fatal, log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/output'

export default {
  name: 'use',
  description: 'Set the active CLI identity',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (name: string, opts: RawOutputOpts) => {
    try {
      await setDefault(name)
      if (isMachine(opts)) {
        output({ default: name }, opts)
        return
      }
      log.success(`Active identity set to "${name}"`)
    } catch (e) {
      fatal(e, opts)
    }
  },
} satisfies CommandDefinition
