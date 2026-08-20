import type { CommandDefinition } from '../../program/index'

import { getIdentity, setIdentityMode } from '../../identity/index'
import { fatal, fatalNotImplemented, log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/output'

export default {
  name: 'sync',
  description: 'Migrate an identity local → remote (astrale cloud)',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  options: [
    {
      flags: '--force',
      description: 'Tag as remote in the local registry even without cloud login',
    },
    ...RAW_OUTPUT_OPTIONS,
  ],
  action: async (name: string, opts: { force?: boolean } & RawOutputOpts) => {
    try {
      const identity = await getIdentity(name)
      if (!opts.force) {
        fatalNotImplemented(
          'identity sync (remote)',
          'Cloud adapter is stubbed in v1. Use --force to pre-tag the identity locally.',
        )
      }
      await setIdentityMode(name, 'remote')
      if (isMachine(opts)) {
        output({ name, mode: 'remote', subject: identity.subject }, opts)
        return
      }
      log.warn(`Tagged "${name}" as remote locally (cloud sync stubbed in v1)`)
      log.dim(`  subject=${identity.subject}`)
    } catch (e) {
      fatal(e, opts)
    }
  },
} satisfies CommandDefinition
