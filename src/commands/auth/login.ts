import type { CommandDefinition } from '../../command'

import { upsertIdpIdentity } from '../../lib/identity'
import {
  decodeTokenClaims,
  exchangeAuthorizationCode,
  identityNameFromClaims,
  issuerFromToken,
  normalizeTokenResponse,
  pollDeviceToken,
  readIdpConfigOrBuiltin,
  readIdpStore,
  requestClientCredentials,
  requestDeviceAuthorization,
  saveIdpSession,
  subjectFromToken,
  tokenAudienceMatches,
  tokenExpiresAt,
  workosClientIdFromEnv,
  type IdpSession,
  type TokenResponse,
} from '../../lib/idp'
import { log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS } from '../../lib/output'

type LoginOpts = {
  idp?: string
  name?: string
  scope?: string
  audience?: string
  clientId?: string
  clientSecretEnv?: string
  clientCredentials?: boolean
  device?: boolean
  code?: string
  redirectUri?: string
  codeVerifier?: string
  use?: boolean
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
`,
  action: async (opts: LoginOpts) => {
    const idpName = await resolveIdpName(opts.idp)
    const idp = await readIdpConfigOrBuiltin(idpName, { clientId: opts.clientId, persist: true })
    const scope = opts.scope ?? idp.client.scope ?? 'openid profile email offline_access'

    const token = normalizeTokenResponse(await obtainToken(idp, opts, scope))
    if (!token.access_token) throw new Error('IdP response did not include access_token')
    if (opts.audience && !tokenAudienceMatches(token.access_token, opts.audience)) {
      throw new Error(
        `IdP response access_token was not minted for requested audience ${opts.audience}`,
      )
    }

    const claims = decodeTokenClaims(token.id_token ?? token.access_token)
    const subject = subjectFromToken(token, opts.clientId ?? idp.client.client_id ?? idpName)
    const issuer = issuerFromToken(token, idp.metadata.issuer)
    const identityName = opts.name ?? identityNameFromClaims(claims, idpName)
    const session: IdpSession = {
      identity: identityName,
      idp: idpName,
      issuer,
      subject,
      audience: opts.audience,
      access_token: token.access_token,
      id_token: token.id_token,
      refresh_token: token.refresh_token,
      token_type: token.token_type,
      scope: token.scope ?? scope,
      expires_at: tokenExpiresAt(token),
      claims: claims ? (claims as Record<string, unknown>) : undefined,
      updatedAt: new Date().toISOString(),
    }

    await saveIdpSession(session)
    await upsertIdpIdentity(identityName, {
      subject,
      idp: idpName,
      issuer,
      audience: opts.audience,
      claims: session.claims,
      use: opts.use,
    })

    const rendered = publicSession(session)
    if (isMachine(opts)) {
      output(rendered, opts)
      return
    }

    log.success(`Logged in as "${identityName}" via IdP "${idpName}"`)
    log.dim(`  subject: ${subject}`)
    if (session.expires_at) log.dim(`  expires_at: ${session.expires_at}`)
    if (opts.use !== false) log.dim('  default identity updated')
  },
} satisfies CommandDefinition

async function resolveIdpName(name: string | undefined): Promise<string> {
  if (name) return name
  const store = await readIdpStore()
  const names = Object.keys(store.idps)
  if (names.length === 1) return names[0]
  if (names.length === 0 && workosClientIdFromEnv()) return 'workos'
  if (names.length === 0)
    throw new Error('No IdPs configured. Run: astrale idp add <name> --issuer <url>')
  throw new Error(`Multiple IdPs configured. Choose one with --idp: ${names.join(', ')}`)
}

async function obtainToken(
  idp: Awaited<ReturnType<typeof readIdpConfigOrBuiltin>>,
  opts: LoginOpts,
  scope: string,
): Promise<TokenResponse> {
  if (opts.clientCredentials) {
    return requestClientCredentials({
      idp,
      clientId: opts.clientId,
      clientSecretEnv: opts.clientSecretEnv,
      scope,
      audience: opts.audience,
    })
  }

  if (opts.code) {
    if (!opts.redirectUri) throw new Error('--redirect-uri is required with --code')
    return exchangeAuthorizationCode({
      idp,
      code: opts.code,
      redirectUri: opts.redirectUri,
      codeVerifier: opts.codeVerifier,
      clientId: opts.clientId,
      clientSecretEnv: opts.clientSecretEnv,
    })
  }

  const device = await requestDeviceAuthorization({
    idp,
    clientId: opts.clientId,
    scope,
    audience: opts.audience,
  })
  if (device.verification_uri_complete) log.info(`Open: ${device.verification_uri_complete}`)
  else if (device.verification_uri) log.info(`Open: ${device.verification_uri}`)
  if (device.user_code) log.info(`Code: ${device.user_code}`)
  if (device.message) log.dim(`  ${device.message}`)

  return pollDeviceToken({
    idp,
    deviceCode: device.device_code,
    clientId: opts.clientId,
    clientSecretEnv: opts.clientSecretEnv,
    intervalSec: device.interval,
    expiresInSec: device.expires_in,
  })
}

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
