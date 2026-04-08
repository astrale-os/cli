import type { CommandDefinition } from '../../command'

import { createIdentity } from '../../lib/identity'
import { log } from '../../lib/log'

export default {
  name: 'create',
  description: 'Create a new identity',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  options: [{ flags: '--subject <sub>', description: 'Custom subject (defaults to name)' }],
  action: async (name: string, opts: { subject?: string }) => {
    try {
      const identity = await createIdentity(name, opts.subject)
      log.success(`Created identity "${name}" (subject: ${identity.subject})`)
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
} satisfies CommandDefinition
