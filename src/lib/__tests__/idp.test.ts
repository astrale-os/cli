import { describe, expect, test } from 'bun:test'

import {
  accessTokenForAudience,
  classifyRefreshFailure,
  OAuthTokenError,
  postForm,
  withCachedToken,
  type IdpSession,
} from '../idp'

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
        fresh: { access_token: 'kept', expires_at: '2999-01-01T00:00:00.000Z' },
      },
      jwt,
      '2999-01-01T00:00:00.000Z',
    )

    expect(Object.keys(tokens ?? {}).sort()).toEqual(['a', 'b', 'fresh'])
    expect(tokens?.a?.access_token).toBe(jwt)
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

function unsignedJwt(payload: Record<string, unknown>): string {
  return [base64url({ alg: 'none', typ: 'JWT' }), base64url(payload), ''].join('.')
}

function base64url(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
