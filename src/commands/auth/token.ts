import type { CommandDefinition } from '../../command'

import { getDefault, getIdentity, readIdentities } from '../../lib/identity'
import { isSessionExpired, readIdpSession, refreshSession, type IdpSession } from '../../lib/idp'
import { log } from '../../lib/log'
import { output } from '../../lib/output'

type AuthTokenType = 'access' | 'id'

type AuthTokenOpts = {
  name?: string
  idp?: string
  type?: AuthTokenType
  refresh?: boolean
  raw?: boolean
  json?: boolean
}

type AuthTokenResult = {
  identity: string
  idp: string
  issuer: string
  subject: string
  type: AuthTokenType
  token: string
  token_type?: string
  scope?: string
  expires_at?: string
  expired: boolean
  refreshed: boolean
  updatedAt: string
}

export default {
  name: 'token',
  description: 'Print a cached IdP provider token for an IdP-backed identity',
  options: [
    {
      flags: '--name <name>',
      description: 'IdP-backed identity name (defaults to active identity)',
    },
    { flags: '--idp <name>', description: 'Select the IdP when identity name is omitted' },
    {
      flags: '--type <type>',
      description: 'Token type to print',
      choices: ['access', 'id'],
      default: 'access',
    },
    {
      flags: '--no-refresh',
      description: 'Do not refresh an expired cached session before printing',
    },
    { flags: '--raw', description: 'Print only the token string' },
    { flags: '--json', description: 'Print JSON metadata including the token' },
  ],
  afterHelpText: `
Behavior:
  Defaults to the active IdP-backed identity. If the cached session is expired,
  the CLI refreshes it before printing unless --no-refresh is passed. --raw
  prints only the token string for shell use.

Examples:
  $ astrale auth token --raw
  $ astrale auth token --idp workos --raw
  $ astrale auth token --name alice --type id --json
`,
  action: async (opts: AuthTokenOpts) => {
    const result = await resolveAuthToken(opts)

    if (opts.raw) {
      process.stdout.write(result.token + '\n')
      return
    }

    if (opts.json) {
      output(result, { json: true })
      return
    }

    log.dim(`  (${result.idp} ${result.type}_token for identity "${result.identity}" - secret)`)
    process.stdout.write(result.token + '\n')
  },
} satisfies CommandDefinition

export async function resolveAuthToken(opts: AuthTokenOpts): Promise<AuthTokenResult> {
  const identityName = await resolveIdentityName(opts)
  const session = await readIdpSession(identityName)
  if (!session) {
    throw new Error(
      `No cached IdP session for "${identityName}". Run: astrale auth login --name ${identityName}`,
    )
  }

  const shouldRefresh = opts.refresh !== false && isSessionExpired(session)
  const resolved = shouldRefresh ? await refreshSession(identityName, session) : session
  const type = opts.type ?? 'access'
  const token = tokenFromSession(resolved, type)

  return {
    identity: resolved.identity,
    idp: resolved.idp,
    issuer: resolved.issuer,
    subject: resolved.subject,
    type,
    token,
    token_type: resolved.token_type,
    scope: resolved.scope,
    expires_at: resolved.expires_at,
    expired: isSessionExpired(resolved),
    refreshed: shouldRefresh,
    updatedAt: resolved.updatedAt,
  }
}

async function resolveIdentityName(opts: AuthTokenOpts): Promise<string> {
  if (opts.name) {
    const identity = await getIdentity(opts.name)
    if ((identity.source ?? 'key') !== 'idp') {
      throw new Error(`Identity "${opts.name}" is not IdP-backed`)
    }
    if (opts.idp && identity.idp !== opts.idp) {
      throw new Error(
        `Identity "${opts.name}" is backed by IdP "${identity.idp ?? '?'}", not "${opts.idp}"`,
      )
    }
    return opts.name
  }

  if (opts.idp) {
    const store = await readIdentities()
    const matches = Object.entries(store.identities)
      .filter(([, identity]) => identity.source === 'idp' && identity.idp === opts.idp)
      .map(([name]) => name)

    if (matches.length === 0) {
      throw new Error(
        `No IdP-backed identities found for IdP "${opts.idp}". Run: astrale auth login --idp ${opts.idp}`,
      )
    }
    if (matches.includes(store.default)) return store.default
    if (matches.length === 1) return matches[0]
    throw new Error(
      `Multiple IdP-backed identities found for IdP "${opts.idp}": ${matches.join(', ')}. Pass --name.`,
    )
  }

  const identity = await getDefault()
  if ((identity.source ?? 'key') !== 'idp') {
    throw new Error('Default identity is not IdP-backed. Pass --name or --idp.')
  }
  return identity.name
}

function tokenFromSession(session: IdpSession, type: AuthTokenType): string {
  if (type === 'access') return session.access_token
  if (session.id_token) return session.id_token
  throw new Error(
    `Cached IdP session for "${session.identity}" has no id_token. Use --type access.`,
  )
}
