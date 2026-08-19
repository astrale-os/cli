import type { CommandDefinition } from '../../program/index'

import { createIdentity } from '../../identity/index'
import { fatal, log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/output'

export default {
  name: 'create',
  description: 'Create a new identity',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  options: [
    { flags: '--subject <sub>', description: 'Custom subject (defaults to name)' },
    { flags: '--local', description: 'Local-only identity (default)' },
    { flags: '--remote', description: 'Remote (cloud-synced) identity — requires cloud login' },
    ...RAW_OUTPUT_OPTIONS,
  ],
  action: async (
    name: string,
    opts: { subject?: string; local?: boolean; remote?: boolean } & RawOutputOpts,
  ) => {
    try {
      const mode = opts.remote ? 'remote' : 'local'
      const identity = await createIdentity(name, { subject: opts.subject, mode })
      if (isMachine(opts)) {
        output({ name, ...identity }, opts)
        return
      }
      log.success(
        `Created identity "${name}" (subject: ${identity.subject}, mode: ${identity.mode})`,
      )
    } catch (e) {
      fatal(e, opts)
    }
  },
} satisfies CommandDefinition
