import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { readIdentities } from '../../lib/identity'
import { isSessionExpired, listIdpSessions } from '../../lib/idp'
import { log } from '../../lib/log'
import { isRawOutput, output, RAW_OUTPUT_OPTIONS } from '../../lib/output'

export default {
  name: 'status',
  description: 'Show cached IdP authentication status',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: { raw?: boolean; json?: boolean }) => {
    const [identityStore, sessions] = await Promise.all([readIdentities(), listIdpSessions()])
    const byIdentity = new Map(sessions.map((session) => [session.identity, session]))
    const identities = Object.entries(identityStore.identities)
      .filter(([, identity]) => identity.source === 'idp')
      .map(([name, identity]) => {
        const session = byIdentity.get(name)
        return {
          name,
          default: identityStore.default === name,
          idp: identity.idp,
          issuer: identity.issuer,
          subject: identity.subject,
          session: session
            ? {
                cached: true,
                expired: isSessionExpired(session),
                expires_at: session.expires_at,
                scope: session.scope,
                has_refresh_token: !!session.refresh_token,
              }
            : { cached: false },
        }
      })

    if (isRawOutput(opts)) {
      output({ default: identityStore.default, identities }, opts)
      return
    }

    if (identities.length === 0) {
      log.dim('  Not logged in to any IdP. Run: astrale auth login --idp <name>')
      return
    }

    for (const identity of identities) {
      const marker = identity.default ? chalk.green(' *') : ''
      const session = identity.session.cached
        ? identity.session.expired
          ? chalk.yellow('expired')
          : chalk.green('active')
        : chalk.dim('no cached session')
      console.log(`  ${chalk.bold(identity.name)}${marker} ${chalk.dim(identity.idp)} ${session}`)
      console.log(`    ${chalk.dim(identity.subject)}`)
    }
  },
} satisfies CommandDefinition
