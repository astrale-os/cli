import type { CommandDefinition } from '../../program/index'

import { deleteIdentity } from '../../identity/index'
import { log } from '../../lib/terminal/log'
import { outputForMachine, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/terminal/output'

export default {
  name: 'delete',
  description: 'Delete an identity',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (name: string, opts: RawOutputOpts) => {
    await deleteIdentity(name)
    if (outputForMachine({ deleted: name }, opts)) return
    log.success(`Deleted identity "${name}"`)
  },
} satisfies CommandDefinition
