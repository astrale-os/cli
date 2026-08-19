import type { CommandDefinition } from '../../program/index'

import { deleteIdentity } from '../../identity/index'
import { fatal, log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/output'

export default {
  name: 'delete',
  description: 'Delete an identity',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (name: string, opts: RawOutputOpts) => {
    try {
      await deleteIdentity(name)
      if (isMachine(opts)) {
        output({ deleted: name }, opts)
        return
      }
      log.success(`Deleted identity "${name}"`)
    } catch (e) {
      fatal(e, opts)
    }
  },
} satisfies CommandDefinition
