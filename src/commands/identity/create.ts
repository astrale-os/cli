import type { CommandDefinition } from '../../command'

import { createIdentity } from '../../lib/identity'
import { fatal, log } from '../../lib/log'

export default {
  name: 'create',
  description: 'Create a new identity',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  options: [
    { flags: '--subject <sub>', description: 'Custom subject (defaults to name)' },
    { flags: '--local', description: 'Local-only identity (default)' },
    { flags: '--remote', description: 'Remote (cloud-synced) identity — requires cloud login' },
  ],
  action: async (name: string, opts: { subject?: string; local?: boolean; remote?: boolean }) => {
    try {
      const mode = opts.remote ? 'remote' : 'local'
      const identity = await createIdentity(name, { subject: opts.subject, mode })
      log.success(
        `Created identity "${name}" (subject: ${identity.subject}, mode: ${identity.mode})`,
      )
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
