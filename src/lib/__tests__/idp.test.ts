import { describe, expect, test } from 'bun:test'

import {
  accessTokenForAudience,
  classifyRefreshFailure,
  decodeTokenClaims,
  identityNameFromClaims,
  IdpClientConfigSchema,
  IdpSessionSchema,
  isSessionExpired,
  issuerFromToken,
  normalizeTokenResponse,
  OAuthTokenError,
  OidcMetadataSchema,
  postForm,
  subjectFromToken,
  tokenExpiresAt,
  tokenAudienceMatches,
  withCachedToken,
  workosClientIdFromEnv,
  workosAuthKitMetadata,
  builtinIdpConfig,
  type IdpSession,
} from '../idp'

describe('IdP schemas and token helpers', () => {
  test('parses WorkOS/AuthKit-style discovery metadata', () => {
    const metadata = OidcMetadataSchema.parse({
      issuer: 'https://example.authkit.app',
      authorization_endpoint: 'https://example.authkit.app/oauth2/authorize',
      token_endpoint: 'https://example.authkit.app/oauth2/token',
      device_authorization_endpoint: 'https://example.authkit.app/oauth2/device_authorization',
      jwks_uri: 'https://example.authkit.app/oauth2/jwks',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'urn:ietf:params:oauth:grant-type:device_code'],
      custom_field: 'kept',
    })

    expect(metadata.issuer).toBe('https://example.authkit.app')
    expect(metadata.device_authorization_endpoint).toContain('/device_authorization')
    expect(metadata.custom_field).toBe('kept')
  })

  test('builds WorkOS AuthKit CLI Auth metadata for api-hosted device flow', () => {
    const metadata = workosAuthKitMetadata('https://api.workos.com', 'client_123')

    expect(metadata.issuer).toBe('https://api.workos.com')
    expect(metadata.device_authorization_endpoint).toBe(
      'https://api.workos.com/user_management/authorize/device',
    )
    expect(metadata.token_endpoint).toBe('https://api.workos.com/user_management/authenticate')
    expect(metadata.jwks_uri).toBe('https://api.workos.com/sso/jwks/client_123')
  })

  test('builds built-in WorkOS IdP config from env client id', () => {
    const config = builtinIdpConfig('workos', undefined, {
      WORKOS_CLIENT_ID: 'client_123',
    })

    expect(config?.entry.builtIn).toBe(true)
    expect(config?.client.client_id).toBe('client_123')
    expect(config?.client.token_response).toBe('workos-authkit')
    expect(config?.client.token_request_format).toBe('json')
  })

  test('builds built-in WorkOS IdP config with the public alpha client id by default', () => {
    const config = builtinIdpConfig('workos', undefined, {})

    expect(config?.entry.builtIn).toBe(true)
    expect(config?.client.client_id).toBe('client_01KC29HEGD7B40TV2C4QZ436BG')
  })

  test('reads WorkOS client id from WORKOS_CLIENT_ID before VITE_WORKOS_CLIENT_ID', () => {
    expect(
      workosClientIdFromEnv({
        WORKOS_CLIENT_ID: 'client_primary',
        VITE_WORKOS_CLIENT_ID: 'client_vite',
      }),
    ).toBe('client_primary')
    expect(workosClientIdFromEnv({ VITE_WORKOS_CLIENT_ID: 'client_vite' })).toBe('client_vite')
    expect(workosClientIdFromEnv({})).toBe('client_01KC29HEGD7B40TV2C4QZ436BG')
  })

  test('stores client secret env names, not secret material', () => {
    const client = IdpClientConfigSchema.parse({
      client_id: 'client_123',
      client_secret_env: 'WORKOS_CLIENT_SECRET',
      redirect_uris: ['http://127.0.0.1:8787/callback'],
      scope: 'openid profile email offline_access',
      public: false,
      workos_application_id: 'app_123',
      workos_application_type: 'oauth',
    })

    expect(client.client_secret_env).toBe('WORKOS_CLIENT_SECRET')
    expect(JSON.stringify(client)).not.toContain('sk_')
  })

  test('parses cached sessions with claims but redacts nothing into schema', () => {
    const session = IdpSessionSchema.parse({
      identity: 'alice',
      idp: 'workos',
      issuer: 'https://example.authkit.app',
      subject: 'user_123',
      access_token: 'opaque-token',
      refresh_token: 'refresh-token',
      token_type: 'Bearer',
      scope: 'openid profile email',
      expires_at: '2030-01-01T00:00:00.000Z',
      claims: { email: 'alice@example.com' },
      updatedAt: '2024-01-01T00:00:00.000Z',
    })

    expect(session.claims?.email).toBe('alice@example.com')
    expect(session.refresh_token).toBe('refresh-token')
  })

  test('derives expiry timestamp from expires_in', () => {
    const expiresAt = tokenExpiresAt({ expires_in: 60 })
    expect(expiresAt).toBeString()
    expect(new Date(expiresAt!).getTime()).toBeGreaterThan(Date.now())
  })

  test('derives expiry timestamp from WorkOS camelCase and JWT claims', () => {
    const camelCaseExpiresAt = tokenExpiresAt({ expiresIn: 60 })
    expect(camelCaseExpiresAt).toBeString()
    expect(new Date(camelCaseExpiresAt!).getTime()).toBeGreaterThan(Date.now())

    const jwtExpiresAt = tokenExpiresAt({
      access_token: unsignedJwt({ exp: 1893456000 }),
    })
    expect(jwtExpiresAt).toBe('2030-01-01T00:00:00.000Z')
  })

  test('decodes JWT claims for identity naming, subject, and issuer', () => {
    const jwt = unsignedJwt({
      iss: 'https://example.authkit.app',
      sub: 'user_123',
      email: 'Alice Smith@example.com',
    })
    const claims = decodeTokenClaims(jwt)

    expect(claims?.sub).toBe('user_123')
    expect(identityNameFromClaims(claims, 'fallback')).toBe('Alice-Smith-example.com')
    expect(subjectFromToken({ access_token: jwt }, 'fallback')).toBe('user_123')
    expect(issuerFromToken({ access_token: jwt }, 'fallback')).toBe('https://example.authkit.app')
  })

  test('matches string and array JWT audiences', () => {
    expect(
      tokenAudienceMatches(
        unsignedJwt({ aud: 'https://kernel.example.com' }),
        'https://kernel.example.com',
      ),
    ).toBe(true)
    expect(
      tokenAudienceMatches(
        unsignedJwt({ aud: ['api', 'https://kernel.example.com'] }),
        'https://kernel.example.com',
      ),
    ).toBe(true)
    expect(
      tokenAudienceMatches(unsignedJwt({ aud: 'unknown/api' }), 'https://kernel.example.com'),
    ).toBe(false)
  })

  test('detects expired sessions with skew', () => {
    expect(isSessionExpired({ expires_at: '2000-01-01T00:00:00.000Z' })).toBe(true)
    expect(isSessionExpired({ expires_at: '2999-01-01T00:00:00.000Z' })).toBe(false)
    expect(isSessionExpired({})).toBe(false)
  })

  test('detects expired sessions from cached JWT exp when expires_at is missing', () => {
    expect(isSessionExpired({ access_token: unsignedJwt({ exp: 946684800 }) })).toBe(true)
    expect(isSessionExpired({ access_token: unsignedJwt({ exp: 32503680000 }) })).toBe(false)
  })

  test('normalizes WorkOS camelCase token response fields', () => {
    const token = normalizeTokenResponse({
      accessToken: 'access',
      idToken: 'id',
      refreshToken: 'refresh',
      user: { id: 'user_123' },
    })

    expect(token.access_token).toBe('access')
    expect(token.id_token).toBe('id')
    expect(token.refresh_token).toBe('refresh')
    expect(subjectFromToken(token, 'fallback')).toBe('user_123')
  })

  test('parses sessions with and without the per-audience tokens map', () => {
    const base = {
      identity: 'alice',
      idp: 'workos',
      issuer: 'https://example.authkit.app',
      subject: 'user_123',
      access_token: 'opaque-token',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }

    expect(IdpSessionSchema.parse(base).tokens).toBeUndefined()

    const withMap = IdpSessionSchema.parse({
      ...base,
      tokens: {
        'https://kernel.example.com': {
          access_token: 'aud-token',
          expires_at: '2999-01-01T00:00:00.000Z',
          extra: 'kept',
        },
      },
      unknown_key: 'kept',
    })
    expect(withMap.tokens?.['https://kernel.example.com']?.access_token).toBe('aud-token')
    expect((withMap as Record<string, unknown>).unknown_key).toBe('kept')
  })
})

describe('accessTokenForAudience', () => {
  const session = (overrides: Partial<IdpSession>): IdpSession => ({
    identity: 'alice',
    idp: 'workos',
    issuer: 'https://example.authkit.app',
    subject: 'user_123',
    access_token: 'top-level',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  })

  test('without an audience, returns the top-level token while fresh', () => {
    expect(accessTokenForAudience(session({ expires_at: '2999-01-01T00:00:00.000Z' }))).toBe(
      'top-level',
    )
    expect(
      accessTokenForAudience(session({ expires_at: '2000-01-01T00:00:00.000Z' })),
    ).toBeUndefined()
  })

  test('prefers a fresh per-audience map entry', () => {
    const s = session({
      access_token: unsignedJwt({ aud: 'https://other.example.com' }),
      expires_at: '2999-01-01T00:00:00.000Z',
      tokens: {
        'https://kernel.example.com': {
          access_token: 'aud-token',
          expires_at: '2999-01-01T00:00:00.000Z',
        },
      },
    })

    expect(accessTokenForAudience(s, 'https://kernel.example.com')).toBe('aud-token')
  })

  test('ignores an expired map entry and falls back to the top-level aud claim', () => {
    const jwt = unsignedJwt({ aud: 'https://kernel.example.com' })
    const s = session({
      access_token: jwt,
      expires_at: '2999-01-01T00:00:00.000Z',
      tokens: {
        'https://kernel.example.com': {
          access_token: 'stale',
          expires_at: '2000-01-01T00:00:00.000Z',
        },
      },
    })

    expect(accessTokenForAudience(s, 'https://kernel.example.com')).toBe(jwt)
    expect(accessTokenForAudience(s, 'https://elsewhere.example.com')).toBeUndefined()
  })

  test('matches array aud claims on the top-level token', () => {
    const jwt = unsignedJwt({ aud: ['api', 'https://kernel.example.com'] })
    const s = session({ access_token: jwt, expires_at: '2999-01-01T00:00:00.000Z' })

    expect(accessTokenForAudience(s, 'https://kernel.example.com')).toBe(jwt)
  })
})

describe('withCachedToken', () => {
  test('caches a minted token under every aud it carries and prunes expired entries', () => {
    const jwt = unsignedJwt({ aud: ['a', 'b'] })
    const tokens = withCachedToken(
      {
        stale: { access_token: 'old', expires_at: '2000-01-01T00:00:00.000Z' },
        fresh: { access_token: 'kept', expires_at: '2999-01-01T00:00:00.000Z' },
      },
      jwt,
      '2999-01-01T00:00:00.000Z',
    )

    expect(Object.keys(tokens ?? {}).sort()).toEqual(['a', 'b', 'fresh'])
    expect(tokens?.a?.access_token).toBe(jwt)
  })

  test('returns undefined for an aud-less opaque token with no prior entries', () => {
    expect(withCachedToken(undefined, 'opaque', undefined)).toBeUndefined()
  })
})

describe('OAuth token errors', () => {
  test('postForm surfaces the OAuth error code as a typed error', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json(
          { error: 'invalid_grant', error_description: 'Refresh token already exchanged.' },
          { status: 400 },
        ),
    })
    try {
      const promise = postForm(
        `http://${server.hostname}:${server.port}/token`,
        new URLSearchParams(),
      )
      await expect(promise).rejects.toBeInstanceOf(OAuthTokenError)
      const error = await promise.catch((e) => e as OAuthTokenError)
      expect(error.code).toBe('invalid_grant')
      expect(error.status).toBe(400)
      expect(error.message).toContain('Refresh token already exchanged.')
    } finally {
      await server.stop(true)
    }
  })

  test('postForm turns a non-JSON proxy error body into an OAuthTokenError, not a SyntaxError', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response('<html>Bad Gateway</html>', { status: 502 }),
    })
    try {
      const error = await postForm(
        `http://${server.hostname}:${server.port}/token`,
        new URLSearchParams(),
      ).catch((e) => e as OAuthTokenError)
      expect(error).toBeInstanceOf(OAuthTokenError)
      expect(error.status).toBe(502)
    } finally {
      await server.stop(true)
    }
  })

  test('classifies refresh failures: dead grant vs transient vs unknown', () => {
    expect(classifyRefreshFailure(new OAuthTokenError({ code: 'invalid_grant' }))).toBe(
      'session-ended',
    )
    expect(classifyRefreshFailure(new OAuthTokenError({ status: 503 }))).toBe('transient')
    expect(classifyRefreshFailure(new OAuthTokenError({ status: 429 }))).toBe('transient')
    expect(classifyRefreshFailure(new TypeError('fetch failed'))).toBe('transient')
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(classifyRefreshFailure(abort)).toBe('transient')
    expect(classifyRefreshFailure(new OAuthTokenError({ code: 'invalid_client' }))).toBe('unknown')
    expect(classifyRefreshFailure(new Error('weird'))).toBe('unknown')
  })
})

function unsignedJwt(payload: Record<string, unknown>): string {
  return [base64url({ alg: 'none', typ: 'JWT' }), base64url(payload), ''].join('.')
}

function base64url(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
