import { describe, expect, test } from 'bun:test'

import {
  accessTokenForAudience,
  classifyRefreshFailure,
  identityNameFromClaims,
  normalizeTokenResponse,
  OAuthTokenError,
  postForm,
  tokenExpiresAt,
  withCachedToken,
  type IdpSession,
} from '../idp/provider'
import { validateName } from '../validation'
import { tokenEndpoint, unsignedJwt } from './idp.fixture'

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

  test('prefers a fresh per-audience map entry, else a fresh top-level token for that aud', () => {
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
    const jwt = unsignedJwt({ aud: ['api', 'https://kernel.example.com'] })
    const stale = session({
      access_token: jwt,
      expires_at: '2999-01-01T00:00:00.000Z',
      tokens: {
        'https://kernel.example.com': {
          access_token: 'stale',
          expires_at: '2000-01-01T00:00:00.000Z',
        },
      },
    })
    expect(accessTokenForAudience(stale, 'https://kernel.example.com')).toBe(jwt)
    expect(accessTokenForAudience(stale, 'https://elsewhere.example.com')).toBeUndefined()
  })
})

describe('withCachedToken', () => {
  test('caches a minted token under every aud it carries and prunes expired entries', () => {
    const jwt = unsignedJwt({ aud: ['a', 'b'] })
    const tokens = withCachedToken(
      {
        stale: { access_token: 'old', expires_at: '2000-01-01T00:00:00.000Z' },
        // Without a recorded expiry, the token's own JWT exp decides.
        lapsed: { access_token: unsignedJwt({ exp: 946_684_800 }) },
        fresh: { access_token: 'kept', expires_at: '2999-01-01T00:00:00.000Z' },
      },
      jwt,
      '2999-01-01T00:00:00.000Z',
    )

    expect(Object.keys(tokens ?? {}).sort()).toEqual(['a', 'b', 'fresh'])
    expect(tokens?.a?.access_token).toBe(jwt)
  })
})

test('decodes the expiry and the WorkOS camelCase fields of a token response', () => {
  const now = Date.now()
  for (const lifetime of [{ expires_in: 60 }, { expiresIn: 60 }]) {
    expect(Date.parse(tokenExpiresAt(lifetime)!)).toBeGreaterThanOrEqual(now + 60_000)
  }
  expect(
    normalizeTokenResponse({ accessToken: 'a', idToken: 'i', refreshToken: 'r' }),
  ).toMatchObject({ access_token: 'a', id_token: 'i', refresh_token: 'r' })
})

test('names a login identity from its claims as a valid identity name', () => {
  for (const [claims, name] of [
    [{ email: 'Ada Lovelace+cli@example.com', sub: 'user_1' }, 'Ada-Lovelace-cli-example.com'],
    [{ preferred_username: 'ada', sub: 'user_1' }, 'ada'],
    [{ sub: '///' }, 'workos'],
  ] as const) {
    expect(identityNameFromClaims(claims, 'workos')).toBe(name)
    validateName(name, 'Identity')
  }
})

describe('OAuth token errors', () => {
  test('postForm surfaces the OAuth error code as a typed error', async () => {
    const server = tokenEndpoint({
      answer: () =>
        Response.json(
          { error: 'invalid_grant', error_description: 'Refresh token already exchanged.' },
          { status: 400 },
        ),
    })
    try {
      const error = await postForm(`${server.url}/token`, new URLSearchParams()).catch(
        (cause: unknown) => cause,
      )
      expect(error).toBeInstanceOf(OAuthTokenError)
      expect(error).toMatchObject({
        code: 'invalid_grant',
        status: 400,
        message: expect.stringContaining('Refresh token already exchanged.'),
      })
    } finally {
      await server.stop()
    }
  })

  test('classifies refresh failures: dead grant vs transient vs unknown', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    for (const [failure, kind] of [
      [new OAuthTokenError({ code: 'invalid_grant' }), 'session-ended'],
      [new OAuthTokenError({ status: 503 }), 'transient'],
      [new OAuthTokenError({ status: 429 }), 'transient'],
      [new TypeError('fetch failed'), 'transient'],
      [abort, 'transient'],
      [new OAuthTokenError({ code: 'invalid_client' }), 'unknown'],
      [new Error('weird'), 'unknown'],
    ] as const) {
      expect(classifyRefreshFailure(failure)).toBe(kind)
    }
    // A healthy session refused for a stale org scope: a re-login can never fix it.
    expect(
      classifyRefreshFailure(
        new OAuthTokenError({
          code: 'invalid_grant',
          description: 'User is not a member of the organization.',
        }),
      ),
    ).toBe('org-rejected')
  })
})
