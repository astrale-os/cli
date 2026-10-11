import { upsertIdpIdentity } from '../../identity/registry'
import { readIdentityStore } from '../../state/index'
import { log, withSpinner } from '../terminal/log'
import { isMachine } from '../terminal/output'
import {
  BUILTIN_WORKOS_IDP_NAME,
  decodeTokenClaims,
  identityNameFromClaims,
  normalizeTokenResponse,
  post,
  postForm,
  readIdpConfigOrBuiltin,
  readIdpSession,
  readIdpStore,
  requireClientId,
  resolveClientSecret,
  saveIdpSession,
  tokenAudienceMatches,
  tokenExpiresAt,
  withCachedToken,
  type IdpConfig,
  type IdpSession,
  type TokenResponse,
} from './provider'

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
  /**
   * Optional device-flow presentation boundary. When supplied, the caller
   * receives the verification coordinates instead of terminal log output.
   */
  onVerification?: (event: DeviceVerification) => void
}

export type DeviceVerification = {
  verificationUri: string
  verificationUriComplete?: string
  userCode?: string
  expiresIn?: number
  message?: string
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
  // Reject unsupported local state before requesting credentials or publishing a session.
  await readIdentityStore()
  const idpName = await resolveIdpName(opts.idp)
  const previous = opts.name && !opts.clientId ? await readIdpSession(opts.name) : null
  const savedClientId = previous?.idp === idpName ? previous.clientId : undefined
  const requestedClientId = opts.clientId ?? savedClientId
  const idp = await readIdpConfigOrBuiltin(idpName, {
    clientId: requestedClientId,
    persist: true,
  })
  const clientId = requireClientId(idp, requestedClientId)
  const scope = opts.scope ?? idp.client.scope ?? 'openid profile email offline_access'

  const token = normalizeTokenResponse(await obtainToken(idp, { ...opts, clientId }, scope))
  if (!token.access_token) throw new Error('IdP response did not include access_token')
  if (opts.audience && !tokenAudienceMatches(token.access_token, opts.audience)) {
    throw new Error(
      `IdP response access_token was not minted for requested audience ${opts.audience}`,
    )
  }

  const claims = decodeTokenClaims(token.id_token ?? token.access_token)
  const subject =
    typeof claims?.sub === 'string' && claims.sub ? claims.sub : (token.user?.id ?? clientId)
  const issuer = typeof claims?.iss === 'string' && claims.iss ? claims.iss : idp.metadata.issuer
  const identityName = opts.name ?? identityNameFromClaims(claims, idpName)
  const session: IdpSession = {
    identity: identityName,
    idp: idpName,
    issuer,
    subject,
    clientId,
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
  if (names.length === 0) return BUILTIN_WORKOS_IDP_NAME
  throw new Error(`Multiple IdPs configured. Choose one with --idp: ${names.join(', ')}`)
}

/** OAuth parameters of one request: the given fields that hold a value, beside the client id. */
function oauthParams(
  clientId: string,
  fields: Record<string, string | undefined>,
): URLSearchParams {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(fields)) if (value) params.set(name, value)
  params.set('client_id', clientId)
  return params
}

async function obtainToken(
  idp: IdpConfig,
  opts: LoginFlowOpts & { readonly clientId: string },
  scope: string,
): Promise<TokenResponse> {
  const { clientId, audience } = opts
  const tokenEndpoint = idp.metadata.token_endpoint
  if (opts.clientCredentials) {
    const secret = resolveClientSecret(idp, opts.clientSecretEnv)
    if (!secret) throw new Error('Client credentials flow requires a client secret env var')
    return postForm(
      tokenEndpoint,
      oauthParams(clientId, {
        grant_type: 'client_credentials',
        client_secret: secret,
        scope,
        audience,
      }),
    )
  }

  if (opts.code) {
    if (!opts.redirectUri) throw new Error('--redirect-uri is required with --code')
    return postForm(
      tokenEndpoint,
      oauthParams(clientId, {
        grant_type: 'authorization_code',
        code: opts.code,
        redirect_uri: opts.redirectUri,
        code_verifier: opts.codeVerifier,
        client_secret: resolveClientSecret(idp, opts.clientSecretEnv),
      }),
    )
  }

  const endpoint = idp.metadata.device_authorization_endpoint
  if (!endpoint) {
    throw new Error(`IdP "${idp.name}" does not advertise device_authorization_endpoint`)
  }
  const authorization = await fetch(endpoint, post(oauthParams(clientId, { scope, audience }), idp))
  const device = (await authorization.json()) as DeviceAuthorizationResponse
  if (!authorization.ok || device.error) {
    throw new Error(
      device.error_description ??
        device.error ??
        `Device authorization failed: HTTP ${authorization.status}`,
    )
  }
  const verificationUri = device.verification_uri ?? device.verification_uri_complete
  if (!verificationUri) {
    throw new Error('IdP device authorization response did not include a verification URL')
  }
  const verification: DeviceVerification = {
    verificationUri,
    verificationUriComplete: device.verification_uri_complete,
    userCode: device.user_code,
    expiresIn: device.expires_in,
    message: device.message,
  }
  // `log.*` writes to stdout, which a --json run reserves for its single
  // parseable value — so the coordinates are only printed when a human is
  // reading. A machine caller either supplies `onVerification` or reads the
  // session from the command's JSON.
  if (opts.onVerification) opts.onVerification(verification)
  else if (!isMachine()) {
    log.info(`Open: ${device.verification_uri_complete || verificationUri}`)
    if (device.user_code) log.info(`Code: ${device.user_code}`)
    if (device.message) log.dim(`  ${device.message}`)
  }

  // The longest wait in the CLI: this polls until the user finishes in their
  // browser, which is minutes, not seconds. The spinner outlives the default
  // safety stop (it would give up while the user is still typing a password)
  // and runs to the device code's own expiry instead.
  return withSpinner(
    'Waiting for you to approve the sign-in in your browser',
    !isMachine(),
    async () => {
      const secret = resolveClientSecret(idp, opts.clientSecretEnv)
      let intervalMs = Math.max(device.interval ?? 5, 1) * 1000
      const deadline = Date.now() + device.expires_in * 1000
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
        const params = oauthParams(clientId, {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: device.device_code,
          client_secret: secret,
        })
        const response = await fetch(tokenEndpoint, post(params, idp))
        const body = (await response.json()) as TokenResponse
        const token = normalizeTokenResponse(body)
        if (response.ok && token.access_token) return token
        if (body.error === 'authorization_pending') continue
        if (body.error === 'slow_down') {
          intervalMs += 5_000
          continue
        }
        throw new Error(
          body.error_description ??
            body.error ??
            `Device token request failed: HTTP ${response.status}`,
        )
      }
      throw new Error('Device authorization expired before completion')
    },
    {
      safetyMs: device.expires_in * 1000,
      longRunningText: 'Still waiting for browser approval — the code expires soon.',
    },
  )
}

type DeviceAuthorizationResponse = {
  device_code: string
  user_code?: string
  verification_uri?: string
  verification_uri_complete?: string
  expires_in: number
  interval?: number
  message?: string
  error?: string
  error_description?: string
}
