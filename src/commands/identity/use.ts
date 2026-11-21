import type { CommandDefinition } from '../../program/index'

import { setDefault } from '../../identity/index'
import { log } from '../../lib/terminal/log'
import { outputForMachine, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/terminal/output'

export default {
  name: 'use',
  description: 'Set the active CLI identity',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (name: string, opts: RawOutputOpts) => {
    await setDefault(name)
    if (outputForMachine({ default: name }, opts)) return
    log.success(`Active identity set to "${name}"`)
  },
} satisfies CommandDefinition
