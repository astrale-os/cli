import chalk from 'chalk'

import type { CommandDefinition } from '../../command'
import type { ListOpts, ListProjection } from '../../lib/output'

import { readIdentities } from '../../lib/identity'
import { isSessionExpired, listIdpSessions } from '../../lib/idp'
import { log } from '../../lib/log'
import { isMachine, presentList, RAW_OUTPUT_OPTIONS } from '../../lib/output'

type AuthRow = {
  name: string
  default: boolean
  idp?: string
  issuer?: string
  subject: string
  session:
    | {
        cached: true
        expired: boolean
        expires_at?: string
        scope?: string
        has_refresh_token: boolean
      }
    | { cached: false }
}

function sessionState(s: AuthRow['session']): string {
  if (!s.cached) return chalk.dim('no session')
  return s.expired ? chalk.yellow('expired') : chalk.green('active')
}

function projection(items: AuthRow[]): ListProjection {
  return {
    columns: [
      { key: 'name', header: 'NAME', color: chalk.bold },
      { key: 'session', header: 'SESSION' },
      { key: 'idp', header: 'IDP', color: chalk.dim },
      { key: 'subject', header: 'SUBJECT', color: chalk.dim },
    ],
    rows: items.map((i) => ({
      name: i.default ? `${i.name} ${chalk.green('*')}` : i.name,
      session: sessionState(i.session),
      idp: i.idp ?? '',
      subject: i.subject,
    })),
    paths: items.map((i) => i.name),
  }
}

export default {
  name: 'status',
  description: 'Show cached IdP authentication status',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: ListOpts) => {
    const [identityStore, sessions] = await Promise.all([readIdentities(), listIdpSessions()])
    const byIdentity = new Map(sessions.map((session) => [session.identity, session]))
    const items: AuthRow[] = Object.entries(identityStore.identities)
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

    if (items.length === 0 && !isMachine(opts)) {
      log.dim('  Not logged in to any IdP. Run: astrale auth login --idp <name>')
      return
    }
    presentList(items, opts, projection)
  },
} satisfies CommandDefinition
