import { upsertIdpIdentity } from '../identity/index'
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
  withCachedToken,
  workosClientIdFromEnv,
  type IdpSession,
  type TokenResponse,
} from './idp'
import { log } from './log'

/**
 * The IdP login flow, lifted out of the `auth login` command so it can be
 * driven from anywhere (the command renders the result; `astrale setup` runs it
 * as one hand-held step). The side effects — saving the session cache and
 * upserting the IdP-backed identity — live here so every caller gets identical
 * behavior; presentation (the device URL is logged here; success lines are the
 * caller's) does not.
 */
export type LoginFlowOpts = {
  idp?: string
  name?: string
  scope?: string
  audience?: string
  clientId?: string
  clientSecretEnv?: string
  clientCredentials?: boolean
  code?: string
  redirectUri?: string
  codeVerifier?: string
  /** Switch the default identity to the one we just logged in (default true). */
  use?: boolean
}

export type LoginResult = {
  session: IdpSession
  identityName: string
  idpName: string
}

/**
 * Authenticate against an IdP and persist the result. Throws on any failure
 * (no session is written) — notably BEFORE saving when an explicit `--audience`
 * does not match the minted access token, so a wrong-audience login never
 * leaves a half-written cache.
 */
export async function loginViaIdp(opts: LoginFlowOpts): Promise<LoginResult> {
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
    tokens: withCachedToken(undefined, token.access_token, tokenExpiresAt(token)),
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

  return { session, identityName, idpName }
}

/** Resolve which IdP to use: explicit name, the sole configured one, or WorkOS. */
export async function resolveIdpName(name: string | undefined): Promise<string> {
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
  opts: LoginFlowOpts,
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
