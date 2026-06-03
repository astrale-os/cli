import { describe, expect, test } from 'bun:test'

import {
  decodeTokenClaims,
  identityNameFromClaims,
  IdpClientConfigSchema,
  IdpSessionSchema,
  isSessionExpired,
  issuerFromToken,
  normalizeTokenResponse,
  OidcMetadataSchema,
  subjectFromToken,
  tokenExpiresAt,
  tokenAudienceMatches,
  workosClientIdFromEnv,
  workosAuthKitMetadata,
  builtinIdpConfig,
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

  test('reads WorkOS client id from WORKOS_CLIENT_ID before VITE_WORKOS_CLIENT_ID', () => {
    expect(
      workosClientIdFromEnv({
        WORKOS_CLIENT_ID: 'client_primary',
        VITE_WORKOS_CLIENT_ID: 'client_vite',
      }),
    ).toBe('client_primary')
    expect(workosClientIdFromEnv({ VITE_WORKOS_CLIENT_ID: 'client_vite' })).toBe('client_vite')
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
})

function unsignedJwt(payload: Record<string, unknown>): string {
  return [base64url({ alg: 'none', typ: 'JWT' }), base64url(payload), ''].join('.')
}

function base64url(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
