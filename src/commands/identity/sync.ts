import type { CommandDefinition } from '../../command'

import { getIdentity, setIdentityMode } from '../../lib/identity'
import { fatal, fatalNotImplemented, log } from '../../lib/log'

export default {
  name: 'sync',
  description: 'Migrate an identity local → remote (astrale cloud)',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  options: [
    {
      flags: '--force',
      description: 'Tag as remote in the local registry even without cloud login',
    },
  ],
  action: async (name: string, opts: { force?: boolean }) => {
    try {
      const identity = await getIdentity(name)
      if (!opts.force) {
        fatalNotImplemented(
          'identity sync (remote)',
          'Cloud adapter is stubbed in v1. Use --force to pre-tag the identity locally.',
        )
      }
      await setIdentityMode(name, 'remote')
      log.warn(`Tagged "${name}" as remote locally (cloud sync stubbed in v1)`)
      log.dim(`  subject=${identity.subject}`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
