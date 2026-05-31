import type { CommandDefinition } from '../../command'

import { readIdentities } from '../../lib/identity'
import { removeIdpConfig } from '../../lib/idp'
import { log } from '../../lib/log'
import { output, RAW_OUTPUT_OPTIONS } from '../../lib/output'

export default {
  name: 'remove',
  aliases: ['rm'],
  description: 'Remove an identity provider',
  arguments: [{ name: 'name', description: 'Local IdP registry name' }],
  options: [
    { flags: '--force', description: 'Remove even when IdP-backed identities exist' },
    ...RAW_OUTPUT_OPTIONS,
  ],
  action: async (name: string, opts: { force?: boolean; raw?: boolean; json?: boolean }) => {
    const store = await readIdentities()
    const dependents = Object.entries(store.identities)
      .filter(([, identity]) => identity.source === 'idp' && identity.idp === name)
      .map(([identityName]) => identityName)

    if (dependents.length > 0 && !opts.force) {
      throw new Error(
        `IdP "${name}" is used by identities: ${dependents.join(', ')}. Re-run with --force or delete those identities first.`,
      )
    }

    await removeIdpConfig(name)
    if (opts.raw || opts.json) {
      output({ removed: name, dependentIdentities: dependents }, opts)
      return
    }
    log.success(`IdP "${name}" removed`)
  },
} satisfies CommandDefinition
