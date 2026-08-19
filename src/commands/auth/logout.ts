import type { CommandDefinition } from '../../program/index'

import { getDefault, readIdentities } from '../../identity/index'
import { deleteIdpSession, listIdpSessions } from '../../lib/idp'
import { log } from '../../lib/log'
import { output, RAW_OUTPUT_OPTIONS } from '../../lib/output'
import { ExchangeCredentialCache } from '../../state/index'

export default {
  name: 'logout',
  description: 'Clear cached IdP session tokens',
  options: [
    { flags: '--name <name>', description: 'Identity session to clear' },
    { flags: '--all', description: 'Clear every cached IdP session' },
    ...RAW_OUTPUT_OPTIONS,
  ],
  action: async (opts: { name?: string; all?: boolean; raw?: boolean; json?: boolean }) => {
    let names: string[]
    if (opts.all) {
      names = (await listIdpSessions()).map((session) => session.identity)
    } else if (opts.name) {
      names = [opts.name]
    } else {
      const identity = await getDefault()
      if ((identity.source ?? 'key') !== 'idp') {
        throw new Error('Default identity is not IdP-backed. Pass --name or --all.')
      }
      names = [identity.name]
    }

    for (const name of names) await deleteIdpSession(name)
    await new ExchangeCredentialCache().clear()

    if (opts.raw || opts.json) {
      output({ cleared: names }, opts)
      return
    }
    if (names.length === 0) {
      log.dim('  No cached IdP sessions')
      return
    }
    log.success(`Cleared IdP session${names.length === 1 ? '' : 's'}: ${names.join(', ')}`)

    const store = await readIdentities()
    const stale = names.filter((name) => store.identities[name]?.source === 'idp')
    if (stale.length > 0) {
      log.dim(
        '  IdP identity records remain; delete them with `astrale identity delete <name>` if needed.',
      )
    }
  },
} satisfies CommandDefinition
