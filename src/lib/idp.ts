import { decodeJwt, type JWTPayload } from 'jose'
import { mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'

import { paths } from './env'
import { atomicWrite } from './fs-atomic'
import { log } from './log'
import { IDPS_PATH, IDP_SESSIONS_DIR } from './paths'
import { validateName, validateUrl } from './validation'

/**
 * Thrown when a refresh succeeds but the IdP mints an access token whose `aud`
 * does not match the one the caller requested. Distinct from a transport/grant
 * failure: the session is *healthy*, the IdP simply will not issue that
 * audience (e.g. WorkOS AuthKit ignores the `audience` param and stamps a fixed
 * API audience per environment). Re-login does not help — callers must target
 * an instance whose audience equals `actual`, or reconfigure the IdP/bookmark.
 */
export class IdpAudienceMismatchError extends Error {
  readonly requested: string
  readonly actual: string | undefined

  constructor(requested: string, actual: string | undefined) {
    super(
      `IdP minted an access token for audience ${actual ?? '(none)'} but ${requested} was required`,
    )
    this.name = 'IdpAudienceMismatchError'
    this.requested = requested
    this.actual = actual
  }
}

/**
 * A token-endpoint request that the IdP answered with an OAuth error (or that
 * failed at the HTTP layer). Carries the structured OAuth `error` code so
 * callers can tell a definitively dead grant (`invalid_grant`) from a
 * transient outage — the message string alone cannot.
 */
export class OAuthTokenError extends Error {
  /** OAuth `error` code, e.g. `invalid_grant`. */
  readonly code?: string
  /** OAuth `error_description`. */
  readonly description?: string
  /** HTTP status of the token response. */
  readonly status?: number

  constructor(args: { code?: string; description?: string; status?: number }) {
    super(
      `OAuth token request failed: ${args.description ?? args.code ?? `HTTP ${args.status ?? '?'}`}`,
    )
    this.name = 'OAuthTokenError'
    this.code = args.code
    this.description = args.description
    this.status = args.status
  }
}

export type RefreshFailureKind = 'session-ended' | 'org-rejected' | 'transient' | 'unknown'

/**
 * Classify a `refreshSession` failure so callers only demand a re-login when
 * the grant is actually dead. `org-rejected` = healthy session, wrong/stale
 * org scope (re-login can't fix it); 5xx/429 and fetch-layer failures are
 * transient — the cached session is likely still valid.
 */
export function classifyRefreshFailure(e: unknown): RefreshFailureKind {
  if (e instanceof OAuthTokenError) {
    if (
      /not a member of the organization|organization not found/i.test(e.description ?? e.message)
    ) {
      return 'org-rejected'
    }
    if (e.code === 'invalid_grant') return 'session-ended'
    if (e.status !== undefined && (e.status >= 500 || e.status === 429)) return 'transient'
    return 'unknown'
  }
  if (e instanceof Error) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return 'transient'
    // Node's fetch rejects network-layer failures as TypeError.
    if (e instanceof TypeError) return 'transient'
    // Bun stamps codes like ConnectionRefused/ConnectionClosed/FailedToOpenSocket;
    // Node uses the classic ECONN*/ETIMEDOUT family.
    const code = (e as { code?: string }).code
    if (
      typeof code === 'string' &&
      /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|Connection|FailedToOpenSocket|Timeout)/.test(
        code,
      )
    ) {
      return 'transient'
    }
  }
  return 'unknown'
}

export const OidcMetadataSchema = z
  .object({
    issuer: z.string().url(),
    authorization_endpoint: z.string().url().optional(),
    token_endpoint: z.string().url(),
    jwks_uri: z.string().url(),
    device_authorization_endpoint: z.string().url().optional(),
    revocation_endpoint: z.string().url().optional(),
    scopes_supported: z.array(z.string()).optional(),
    grant_types_supported: z.array(z.string()).optional(),
    response_types_supported: z.array(z.string()).optional(),
    code_challenge_methods_supported: z.array(z.string()).optional(),
  })
  .passthrough()

export type OidcMetadata = z.infer<typeof OidcMetadataSchema>

export const IdpClientConfigSchema = z
  .object({
    client_id: z.string().optional(),
    client_secret_env: z.string().optional(),
    redirect_uris: z.array(z.string().url()).optional(),
    scope: z.string().optional(),
    public: z.boolean().optional(),
    token_response: z.enum(['oauth', 'workos-authkit']).optional(),
    token_request_format: z.enum(['form', 'json']).optional(),
    workos_application_id: z.string().optional(),
    workos_application_type: z.enum(['oauth', 'm2m']).optional(),
  })
  .passthrough()

export type IdpClientConfig = z.infer<typeof IdpClientConfigSchema>

export const IdpIndexEntrySchema = z.object({
  issuer: z.string().url(),
  builtIn: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const IdpStoreSchema = z.object({
  idps: z.record(z.string(), IdpIndexEntrySchema),
})

export type IdpStore = z.infer<typeof IdpStoreSchema>
export type IdpIndexEntry = z.infer<typeof IdpIndexEntrySchema>

export const IdpSessionSchema = z
  .object({
    identity: z.string(),
    idp: z.string(),
    issuer: z.string().url(),
    subject: z.string(),
    audience: z.string().optional(),
    organizationId: z.string().optional(),
    access_token: z.string(),
    id_token: z.string().optional(),
    refresh_token: z.string().optional(),
    token_type: z.string().optional(),
    scope: z.string().optional(),
    expires_at: z.string().optional(),
    claims: z.record(z.string(), z.unknown()).optional(),
    /**
     * Access tokens by audience. WorkOS mints one `aud` per token, so a
     * session juggling several instances would otherwise burn a (single-use)
     * refresh-token rotation on every instance flip. The top-level
     * `access_token`/`expires_at` stay the most recently minted token for
     * back-compat with older CLI builds.
     */
    tokens: z
      .record(
        z.string(),
        z.object({ access_token: z.string(), expires_at: z.string().optional() }).passthrough(),
      )
      .optional(),
    updatedAt: z.string(),
  })
  .passthrough()

export type IdpSession = z.infer<typeof IdpSessionSchema>

export type TokenResponse = {
  access_token?: string
  accessToken?: string
  id_token?: string
  idToken?: string
  refresh_token?: string
  refreshToken?: string
  token_type?: string
  scope?: string
  expires_in?: number
  expiresIn?: number
  user?: { id?: string; [key: string]: unknown }
  organization_id?: string
  authentication_method?: string
  error?: string
  error_description?: string
  [key: string]: unknown
}

export type DeviceAuthorizationResponse = {
  device_code: string
  user_code?: string
  verification_uri?: string
  verification_uri_complete?: string
  expires_in: number
  interval?: number
  message?: string
  [key: string]: unknown
}

export type IdpConfig = {
  name: string
  entry: IdpIndexEntry
  metadata: OidcMetadata
  client: IdpClientConfig
}

export const BUILTIN_WORKOS_IDP_NAME = 'workos'
const DEFAULT_WORKOS_API_HOST = 'https://api.workos.com'
const DEFAULT_WORKOS_CLIENT_ID = 'client_01KC29HEGD7B40TV2C4QZ436BG'
const WORKOS_CLIENT_ID_ENV_NAMES = ['WORKOS_CLIENT_ID', 'VITE_WORKOS_CLIENT_ID'] as const

export function idpDir(name: string): string {
  return paths.idpDir(name)
}

export function idpMetadataPath(name: string): string {
  return join(idpDir(name), 'metadata.json')
}

export function idpClientPath(name: string): string {
  return join(idpDir(name), 'client.json')
}

export function idpSessionPath(identityName: string): string {
  validateName(identityName, 'Identity')
  return paths.idpSession(identityName)
}

export async function readIdpStore(): Promise<IdpStore> {
  try {
    const raw = await readFile(IDPS_PATH, 'utf-8')
    return IdpStoreSchema.parse(JSON.parse(raw))
  } catch (e) {
    if (e instanceof z.ZodError) {
      log.warn(`Invalid IdP index at ${IDPS_PATH} — using empty registry`)
    } else if ((e as { code?: string }).code !== 'ENOENT') {
      log.warn(`Could not read IdP index at ${IDPS_PATH} — using empty registry`)
    }
    return { idps: {} }
  }
}

export async function writeIdpStore(store: IdpStore): Promise<void> {
  await mkdir(dirname(IDPS_PATH), { recursive: true })
  await atomicWrite(IDPS_PATH, JSON.stringify(store, null, 2) + '\n')
}

export async function readIdpConfig(name: string): Promise<IdpConfig> {
  validateName(name, 'IdP')
  const store = await readIdpStore()
  const entry = store.idps[name]
  if (!entry)
    throw new Error(`IdP "${name}" not found. Run: astrale idp add ${name} --issuer <url>`)
  const [metadataRaw, clientRaw] = await Promise.all([
    readFile(idpMetadataPath(name), 'utf-8'),
    readFile(idpClientPath(name), 'utf-8').catch((e) => {
      if ((e as { code?: string }).code === 'ENOENT') return '{}'
      throw e
    }),
  ])
  return {
    name,
    entry,
    metadata: OidcMetadataSchema.parse(JSON.parse(metadataRaw)),
    client: IdpClientConfigSchema.parse(JSON.parse(clientRaw)),
  }
}

export async function readIdpConfigOrBuiltin(
  name: string,
  opts: { clientId?: string; persist?: boolean } = {},
): Promise<IdpConfig> {
  validateName(name, 'IdP')
  const store = await readIdpStore()
  if (store.idps[name]) {
    return await readIdpConfig(name)
  }

  const builtin = builtinIdpConfig(name, opts.clientId)
  if (!builtin) {
    throw new Error(`IdP "${name}" not found. Run: astrale idp add ${name} --issuer <url>`)
  }
  if (!opts.persist) return builtin
  return upsertIdpConfig({
    name: builtin.name,
    metadata: builtin.metadata,
    client: builtin.client,
    builtIn: true,
  })
}

export async function listIdpConfigs(): Promise<IdpConfig[]> {
  const store = await readIdpStore()
  const entries = await Promise.all(
    Object.keys(store.idps).map((name) => readIdpConfig(name).catch(() => undefined)),
  )
  const configs = entries.filter((entry): entry is IdpConfig => !!entry)
  if (!store.idps[BUILTIN_WORKOS_IDP_NAME]) {
    const workos = builtinIdpConfig(BUILTIN_WORKOS_IDP_NAME)
    if (workos) configs.push(workos)
  }
  return configs
}

export async function upsertIdpConfig(args: {
  name: string
  metadata: OidcMetadata
  client?: IdpClientConfig
  builtIn?: boolean
}): Promise<IdpConfig> {
  validateName(args.name, 'IdP')
  const store = await readIdpStore()
  const now = new Date().toISOString()
  const existing = store.idps[args.name]
  store.idps[args.name] = {
    issuer: args.metadata.issuer,
    builtIn: args.builtIn ?? existing?.builtIn,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await mkdir(idpDir(args.name), { recursive: true })
  await Promise.all([
    atomicWrite(idpMetadataPath(args.name), JSON.stringify(args.metadata, null, 2) + '\n'),
    atomicWrite(idpClientPath(args.name), JSON.stringify(args.client ?? {}, null, 2) + '\n'),
    writeIdpStore(store),
  ])
  return readIdpConfig(args.name)
}

export async function removeIdpConfig(name: string): Promise<void> {
  validateName(name, 'IdP')
  const store = await readIdpStore()
  const entry = store.idps[name]
  if (!entry) throw new Error(`IdP "${name}" not found`)
  if (entry.builtIn) throw new Error(`Cannot remove built-in IdP "${name}"`)
  delete store.idps[name]
  await writeIdpStore(store)
  await unlink(idpMetadataPath(name)).catch(() => undefined)
  await unlink(idpClientPath(name)).catch(() => undefined)
}

export async function fetchOidcMetadata(issuer: string): Promise<OidcMetadata> {
  validateUrl(issuer)
  const discoveryUrl = new URL('/.well-known/openid-configuration', issuer)
  const response = await fetch(discoveryUrl)
  if (!response.ok) {
    throw new Error(`OIDC discovery failed for ${issuer}: HTTP ${response.status}`)
  }
  const body = await response.json()
  let metadata = OidcMetadataSchema.parse(body)
  if (normalizeIssuer(metadata.issuer) !== normalizeIssuer(issuer)) {
    throw new Error(
      `OIDC issuer mismatch: discovery returned ${metadata.issuer}, expected ${issuer}`,
    )
  }
  if (!metadata.device_authorization_endpoint) {
    const oauthMetadata = await fetchOAuthAuthorizationServerMetadata(issuer).catch(() => undefined)
    if (oauthMetadata) metadata = OidcMetadataSchema.parse({ ...metadata, ...oauthMetadata })
  }
  return metadata
}

export function workosAuthKitMetadata(
  apiHost = 'https://api.workos.com',
  clientId?: string,
): OidcMetadata {
  validateUrl(apiHost)
  const base = apiHost.replace(/\/+$/, '')
  return OidcMetadataSchema.parse({
    issuer: base,
    authorization_endpoint: `${base}/user_management/authorize`,
    token_endpoint: `${base}/user_management/authenticate`,
    device_authorization_endpoint: `${base}/user_management/authorize/device`,
    jwks_uri: clientId ? `${base}/sso/jwks/${clientId}` : `${base}/sso/jwks`,
    grant_types_supported: ['urn:ietf:params:oauth:grant-type:device_code'],
    response_types_supported: ['code'],
  })
}

export function builtinIdpConfig(
  name: string,
  clientIdOverride?: string,
  env: NodeJS.ProcessEnv = process.env,
): IdpConfig | null {
  if (name !== BUILTIN_WORKOS_IDP_NAME) return null
  const clientId = clientIdOverride ?? workosClientIdFromEnv(env)
  if (!clientId) return null
  const apiHost = env.WORKOS_API_HOSTNAME ?? DEFAULT_WORKOS_API_HOST
  const now = new Date().toISOString()
  return {
    name: BUILTIN_WORKOS_IDP_NAME,
    entry: {
      issuer: apiHost.replace(/\/+$/, ''),
      builtIn: true,
      createdAt: now,
      updatedAt: now,
    },
    metadata: workosAuthKitMetadata(apiHost, clientId),
    client: {
      client_id: clientId,
      public: true,
      token_response: 'workos-authkit',
      token_request_format: 'json',
    },
  }
}

export function workosClientIdFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    WORKOS_CLIENT_ID_ENV_NAMES.map((name) => env[name]).find(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ) ?? DEFAULT_WORKOS_CLIENT_ID
  )
}

async function fetchOAuthAuthorizationServerMetadata(
  issuer: string,
): Promise<Partial<OidcMetadata> | undefined> {
  const discoveryUrl = new URL('/.well-known/oauth-authorization-server', issuer)
  const response = await fetch(discoveryUrl)
  if (!response.ok) return undefined
  const body = (await response.json()) as Partial<OidcMetadata>
  if (typeof body.issuer === 'string' && normalizeIssuer(body.issuer) !== normalizeIssuer(issuer)) {
    return undefined
  }
  return body
}

export async function postForm(url: string, params: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  return tokenResponseFrom(response)
}

export async function postJson(
  url: string,
  bodyInput: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyInput),
  })
  return tokenResponseFrom(response)
}

async function tokenResponseFrom(response: Response): Promise<TokenResponse> {
  const text = await response.text()
  let body: TokenResponse = {}
  try {
    body = text ? (JSON.parse(text) as TokenResponse) : {}
  } catch {
    // Non-JSON body (e.g. an HTML 502 from a proxy): surface the HTTP failure,
    // keep a snippet for diagnostics.
    throw new OAuthTokenError({
      status: response.status,
      description: `HTTP ${response.status} — non-JSON response: ${text.slice(0, 200)}`,
    })
  }
  if (!response.ok || body.error) {
    throw new OAuthTokenError({
      code: body.error,
      description: body.error_description,
      status: response.status,
    })
  }
  return body
}

export function tokenExpiresAt(token: TokenResponse): string | undefined {
  const expiresIn =
    typeof token.expires_in === 'number'
      ? token.expires_in
      : typeof token.expiresIn === 'number'
        ? token.expiresIn
        : undefined
  if (typeof expiresIn === 'number') return new Date(Date.now() + expiresIn * 1000).toISOString()
  return tokenExpiresAtFromJwt(token.access_token ?? token.accessToken ?? token.id_token)
}

export function decodeTokenClaims(token: string | undefined): JWTPayload | undefined {
  if (!token) return undefined
  try {
    return decodeJwt(token)
  } catch {
    return undefined
  }
}

export function tokenAudienceMatches(token: string | undefined, audience: string): boolean {
  const actual = decodeTokenClaims(token)?.aud
  if (Array.isArray(actual)) return actual.includes(audience)
  return actual === audience
}

function tokenExpiresAtFromJwt(token: string | undefined): string | undefined {
  const claims = decodeTokenClaims(token)
  return typeof claims?.exp === 'number' ? new Date(claims.exp * 1000).toISOString() : undefined
}

export function subjectFromToken(token: TokenResponse, fallback: string): string {
  const claims = decodeTokenClaims(token.id_token ?? token.access_token)
  const sub = claims?.sub
  return typeof sub === 'string' && sub ? sub : (token.user?.id ?? fallback)
}

export function issuerFromToken(token: TokenResponse, fallback: string): string {
  const claims = decodeTokenClaims(token.id_token ?? token.access_token)
  const iss = claims?.iss
  return typeof iss === 'string' && iss ? iss : fallback
}

export function normalizeTokenResponse(token: TokenResponse): TokenResponse {
  return {
    ...token,
    access_token: token.access_token ?? token.accessToken,
    id_token: token.id_token ?? token.idToken,
    refresh_token: token.refresh_token ?? token.refreshToken,
  }
}

export function identityNameFromClaims(claims: JWTPayload | undefined, fallback: string): string {
  const preferred = [claims?.email, claims?.preferred_username, claims?.sub, fallback].find(
    (v) => typeof v === 'string' && v.length > 0,
  ) as string
  const normalized = preferred.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || fallback
}

export async function saveIdpSession(session: IdpSession): Promise<void> {
  const path = idpSessionPath(session.identity)
  await mkdir(dirname(path), { recursive: true })
  await atomicWrite(path, JSON.stringify(session, null, 2) + '\n')
}

export async function readIdpSession(identityName: string): Promise<IdpSession | null> {
  try {
    const raw = await readFile(idpSessionPath(identityName), 'utf-8')
    return IdpSessionSchema.parse(JSON.parse(raw))
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return null
    if (e instanceof z.ZodError) {
      throw new Error(`Invalid IdP session cache for "${identityName}"`)
    }
    throw e
  }
}

export async function deleteIdpSession(identityName: string): Promise<void> {
  await unlink(idpSessionPath(identityName)).catch(() => undefined)
}

export async function listIdpSessions(): Promise<IdpSession[]> {
  const out: IdpSession[] = []
  let entries: string[] = []
  try {
    entries = (await readdir(IDP_SESSIONS_DIR)).filter((entry) => entry.endsWith('.json'))
  } catch {
    return out
  }
  for (const entry of entries) {
    const name = entry.replace(/\.json$/, '')
    const session = await readIdpSession(name).catch(() => null)
    if (session) out.push(session)
  }
  return out
}

export function isSessionExpired(
  session: Pick<IdpSession, 'expires_at'> & { access_token?: string },
  skewMs = 60_000,
): boolean {
  const expiresAt = session.expires_at ?? tokenExpiresAtFromJwt(session.access_token)
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= Date.now() + skewMs
}

/**
 * A still-fresh access token usable for `audience`, or undefined when a
 * refresh is needed. Checks the per-audience `tokens` map first, then the
 * top-level token's own `aud` claim. Without an `audience`, freshness of the
 * top-level token is the only requirement.
 */
export function accessTokenForAudience(session: IdpSession, audience?: string): string | undefined {
  if (audience === undefined) {
    return isSessionExpired(session) ? undefined : session.access_token
  }
  const entry = session.tokens?.[audience]
  if (entry && !isSessionExpired(entry)) return entry.access_token
  if (!isSessionExpired(session) && tokenAudienceMatches(session.access_token, audience)) {
    return session.access_token
  }
  return undefined
}

/**
 * Fold a freshly minted access token into the per-audience map under every
 * `aud` it carries, dropping entries that have already expired.
 */
export function withCachedToken(
  tokens: IdpSession['tokens'],
  accessToken: string,
  expiresAt: string | undefined,
): IdpSession['tokens'] {
  const next: NonNullable<IdpSession['tokens']> = {}
  for (const [aud, entry] of Object.entries(tokens ?? {})) {
    if (!isSessionExpired(entry)) next[aud] = entry
  }
  const aud = decodeTokenClaims(accessToken)?.aud
  const audiences = Array.isArray(aud) ? aud : typeof aud === 'string' ? [aud] : []
  for (const audience of audiences) {
    next[audience] = { access_token: accessToken, expires_at: expiresAt }
  }
  return Object.keys(next).length > 0 ? next : undefined
}

export function requireClientId(idp: IdpConfig, override?: string): string {
  const clientId = override ?? idp.client.client_id
  if (!clientId) {
    throw new Error(`IdP "${idp.name}" has no client_id. Re-run idp add with --client-id.`)
  }
  return clientId
}

export function resolveClientSecret(idp: IdpConfig, overrideEnv?: string): string | undefined {
  const envName = overrideEnv ?? idp.client.client_secret_env
  if (!envName) return undefined
  const secret = process.env[envName]
  if (!secret) throw new Error(`Client secret env var ${envName} is not set`)
  return secret
}

export async function refreshSession(
  identityName: string,
  session: IdpSession,
  opts: { readonly audience?: string; readonly organizationId?: string } = {},
): Promise<IdpSession> {
  if (!session.refresh_token)
    throw new Error(`IdP session for "${identityName}" has no refresh token`)
  const idp = await readIdpConfig(session.idp)
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: session.refresh_token,
    client_id: requireClientId(idp),
  })
  const audience = opts.audience ?? session.audience
  if (audience) params.set('audience', audience)
  const organizationId = opts.organizationId ?? session.organizationId
  if (organizationId) params.set('organization_id', organizationId)
  if (process.env.ASTRALE_DEBUG_ORG)
    console.error(
      '[debug-org] refresh',
      JSON.stringify({
        audience,
        organizationId,
        sub: (session.claims as { sub?: string } | undefined)?.sub,
      }),
    )
  const secret = resolveClientSecret(idp)
  if (secret) params.set('client_secret', secret)
  const token = normalizeTokenResponse(
    idp.client.token_request_format === 'json'
      ? await postJson(idp.metadata.token_endpoint, Object.fromEntries(params))
      : await postForm(idp.metadata.token_endpoint, params),
  )
  if (!token.access_token) throw new Error('Refresh response did not include access_token')
  const claims = decodeTokenClaims(token.id_token ?? token.access_token)
  const expiresAt = tokenExpiresAt(token)
  const next: IdpSession = {
    ...session,
    access_token: token.access_token,
    id_token: token.id_token ?? session.id_token,
    refresh_token: token.refresh_token ?? session.refresh_token,
    token_type: token.token_type ?? session.token_type,
    scope: token.scope ?? session.scope,
    audience,
    organizationId: organizationId ?? session.organizationId,
    expires_at: expiresAt,
    tokens: withCachedToken(session.tokens, token.access_token, expiresAt),
    claims: claims ? (claims as Record<string, unknown>) : session.claims,
    updatedAt: new Date().toISOString(),
  }
  // Persist the rotated session BEFORE the audience check. WorkOS refresh tokens
  // are single-use: the token request above already exchanged the old one, so the
  // new refresh_token must be saved even when the audience doesn't match — else
  // the cache is stranded on the now-invalid old token and every subsequent
  // refresh dies with "Refresh token already exchanged".
  await saveIdpSession(next)
  if (audience && !tokenAudienceMatches(next.access_token, audience)) {
    const actual = decodeTokenClaims(next.access_token)?.aud
    throw new IdpAudienceMismatchError(
      audience,
      Array.isArray(actual) ? actual.join(', ') : (actual as string | undefined),
    )
  }
  return next
}

export async function requestClientCredentials(args: {
  idp: IdpConfig
  clientId?: string
  clientSecretEnv?: string
  scope?: string
  audience?: string
}): Promise<TokenResponse> {
  const clientId = requireClientId(args.idp, args.clientId)
  const secret = resolveClientSecret(args.idp, args.clientSecretEnv)
  if (!secret) throw new Error('Client credentials flow requires a client secret env var')
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: secret,
  })
  if (args.scope) params.set('scope', args.scope)
  if (args.audience) params.set('audience', args.audience)
  return postForm(args.idp.metadata.token_endpoint, params)
}

export async function requestDeviceAuthorization(args: {
  idp: IdpConfig
  clientId?: string
  scope?: string
  audience?: string
}): Promise<DeviceAuthorizationResponse> {
  const endpoint = args.idp.metadata.device_authorization_endpoint
  if (!endpoint)
    throw new Error(`IdP "${args.idp.name}" does not advertise device_authorization_endpoint`)
  const params = new URLSearchParams({
    client_id: requireClientId(args.idp, args.clientId),
  })
  if (args.scope) params.set('scope', args.scope)
  if (args.audience) params.set('audience', args.audience)
  const response =
    args.idp.client.token_request_format === 'json'
      ? await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(params)),
        })
      : await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
        })
  const body = (await response.json()) as DeviceAuthorizationResponse & {
    error?: string
    error_description?: string
  }
  if (!response.ok || body.error) {
    throw new Error(
      body.error_description ??
        body.error ??
        `Device authorization failed: HTTP ${response.status}`,
    )
  }
  return body
}

export async function pollDeviceToken(args: {
  idp: IdpConfig
  deviceCode: string
  clientId?: string
  clientSecretEnv?: string
  intervalSec?: number
  expiresInSec: number
}): Promise<TokenResponse> {
  const clientId = requireClientId(args.idp, args.clientId)
  const secret = resolveClientSecret(args.idp, args.clientSecretEnv)
  let intervalMs = Math.max(args.intervalSec ?? 5, 1) * 1000
  const deadline = Date.now() + args.expiresInSec * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs))
    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: args.deviceCode,
      client_id: clientId,
    })
    if (secret) params.set('client_secret', secret)
    const response =
      args.idp.client.token_request_format === 'json'
        ? await fetch(args.idp.metadata.token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.fromEntries(params)),
          })
        : await fetch(args.idp.metadata.token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params,
          })
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
}

export async function exchangeAuthorizationCode(args: {
  idp: IdpConfig
  code: string
  redirectUri: string
  codeVerifier?: string
  clientId?: string
  clientSecretEnv?: string
}): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: requireClientId(args.idp, args.clientId),
  })
  if (args.codeVerifier) params.set('code_verifier', args.codeVerifier)
  const secret = resolveClientSecret(args.idp, args.clientSecretEnv)
  if (secret) params.set('client_secret', secret)
  return postForm(args.idp.metadata.token_endpoint, params)
}

export type WorkosApplication = {
  id: string
  client_id?: string
  name?: string
  application_type?: 'oauth' | 'm2m'
  scopes?: string[]
  redirect_uris?: Array<{ uri?: string; default?: boolean }>
  uses_pkce?: boolean
}

export async function fetchWorkosApplication(args: {
  apiKeyEnv: string
  app: string
}): Promise<WorkosApplication> {
  const apiKey = process.env[args.apiKeyEnv]
  if (!apiKey) throw new Error(`WorkOS API key env var ${args.apiKeyEnv} is not set`)
  const response = await fetch(
    `https://api.workos.com/connect/applications/${encodeURIComponent(args.app)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  )
  const body = (await response.json()) as {
    error?: string
    message?: string
    connect_application?: WorkosApplication
  } & WorkosApplication
  if (!response.ok) {
    throw new Error(
      body.message ?? body.error ?? `WorkOS application fetch failed: HTTP ${response.status}`,
    )
  }
  return body.connect_application ?? body
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, '')
}
