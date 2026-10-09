import type { CommandDefinition } from '../../program/index'

import { ACCOUNT_ACTIVATION_WARNINGS, activateLoggedInAccount } from '../../lib/activate-account'
import { type IdpSession } from '../../lib/idp'
import { log } from '../../lib/log'
import { loginViaIdp, type LoginFlowOpts } from '../../lib/login-flow'
import { isMachine, output, RAW_OUTPUT_OPTIONS } from '../../lib/output'

type LoginOpts = LoginFlowOpts & {
  device?: boolean
  raw?: boolean
  json?: boolean
}

export default {
  name: 'login',
  description: 'Authenticate with an IdP and store an IdP-backed identity',
  options: [
    { flags: '--idp <name>', description: 'IdP registry name (defaults when exactly one exists)' },
    { flags: '--name <name>', description: 'Local identity name to create/update' },
    { flags: '--scope <scope>', description: 'OAuth scope override' },
    { flags: '--audience <audience>', description: 'OAuth audience/resource parameter' },
    { flags: '--client-id <id>', description: 'OAuth client ID override' },
    { flags: '--client-secret-env <name>', description: 'Env var containing the client secret' },
    { flags: '--client-credentials', description: 'Use OAuth client_credentials grant' },
    { flags: '--device', description: 'Use OAuth device authorization flow (default)' },
    {
      flags: '--code <code>',
      description: 'Exchange an authorization code instead of device auth',
    },
    { flags: '--redirect-uri <url>', description: 'Redirect URI for authorization-code exchange' },
    {
      flags: '--code-verifier <value>',
      description: 'PKCE verifier for authorization-code exchange',
    },
    {
      flags: '--no-use',
      description: 'Do not switch the default identity to the logged-in identity',
    },
    ...RAW_OUTPUT_OPTIONS,
  ],
  afterHelpText: `
Examples:
  $ astrale auth login --idp workos --device
  $ astrale auth login --idp workos --client-credentials \\
      --client-secret-env WORKOS_CLIENT_SECRET --audience https://api.example.com
  $ astrale auth login --idp workos --code <code> --redirect-uri http://127.0.0.1:8787/callback

Notes:
  Device auth is the default because it matches CLI use. Token values are
  cached locally for credential resolution but are never printed.
  A WorkOS user login also completes the access an administrator prepared for
  this account on Astrale Admin, such as a Fleet invitation. Login succeeds
  even when Admin cannot be reached; run it again later to complete access.
`,
  action: async (opts: LoginOpts) => {
    const { session, identityName, idpName } = await loginViaIdp(opts)
    const adminAccess = await activateLoggedInAccount({
      identityName,
      idpName,
      clientCredentials: opts.clientCredentials,
    })

    if (isMachine(opts)) {
      output(
        { ...publicSession(session), ...(adminAccess ? { admin_access: adminAccess } : {}) },
        opts,
      )
      return
    }

    log.success(`Logged in as "${identityName}" via IdP "${idpName}"`)
    log.dim(`  subject: ${session.subject}`)
    if (session.expires_at) log.dim(`  expires_at: ${session.expires_at}`)
    if (opts.use !== false) log.dim('  default identity updated')
    if (adminAccess && adminAccess !== 'ready') log.warn(ACCOUNT_ACTIVATION_WARNINGS[adminAccess])
  },
} satisfies CommandDefinition

function publicSession(session: IdpSession): Record<string, unknown> {
  return {
    identity: session.identity,
    idp: session.idp,
    issuer: session.issuer,
    subject: session.subject,
    audience: session.audience,
    token_type: session.token_type,
    scope: session.scope,
    expires_at: session.expires_at,
    has_access_token: !!session.access_token,
    has_id_token: !!session.id_token,
    has_refresh_token: !!session.refresh_token,
    updatedAt: session.updatedAt,
  }
}
