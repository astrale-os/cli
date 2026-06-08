import { describe, expect, test } from 'bun:test'

import type { IdentityStore } from '../identity'
import type { IdpSession } from '../idp'
import type { InstanceStore } from '../instance'

import { DEFAULT_ADMIN_TARGET_URL } from '../admin-target'
import { buildLocalStatus, decodeJwtExpiration } from '../local-status'

describe('local status snapshot', () => {
  test('summarizes active bookmark and key identity registration', async () => {
    const instances: InstanceStore = {
      active: 'staging',
      instances: {
        staging: { url: 'https://kernel.example.com', issuer: 'https://issuer.example.com' },
      },
    }
    const identities: IdentityStore = {
      default: 'alice',
      identities: {
        alice: {
          subject: 'alice',
          source: 'key',
          createdAt: '2026-01-01T00:00:00.000Z',
          registrations: {
            staging: {
              iss: 'https://kernel.example.com/iss/thumbprint',
              sub: 'node-1',
              registeredAt: '2026-01-02T00:00:00.000Z',
            },
            admin: {
              iss: 'https://admin.eu.astrale.ai/api/iss/thumbprint',
              sub: 'admin-node-1',
              registeredAt: '2026-01-02T00:00:00.000Z',
            },
          },
        },
      },
    }

    const status = await buildLocalStatus(instances, identities, async () => null)

    expect(status.instance?.active).toBe('staging')
    expect(status.instance?.url).toBe('https://kernel.example.com')
    expect('error' in status.admin).toBe(false)
    if (!('error' in status.admin)) {
      expect(status.admin.url).toBe(DEFAULT_ADMIN_TARGET_URL)
      expect(status.admin.identityRegistered).toBe(true)
    }
    expect(status.identity?.name).toBe('alice')
    expect(status.identity?.source).toBe('key')
    expect(status.identity?.registeredOnActiveInstance).toBe(true)
    expect(status.identity?.registeredOnAdminTarget).toBe(true)
    expect(status.identity?.session).toBeNull()
  })

  test('summarizes expired cached IdP session', async () => {
    const instances: InstanceStore = {
      active: '',
      instances: {},
    }
    const identities: IdentityStore = {
      default: 'workos-user',
      identities: {
        'workos-user': {
          subject: 'user_123',
          source: 'idp',
          mode: 'remote',
          idp: 'workos',
          issuer: 'https://idp.example.com',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }
    const session: IdpSession = {
      identity: 'workos-user',
      idp: 'workos',
      issuer: 'https://idp.example.com',
      subject: 'user_123',
      access_token: 'redacted',
      refresh_token: 'redacted-refresh',
      expires_at: '2000-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    const status = await buildLocalStatus(instances, identities, async () => session)

    expect(status.instance).toBeNull()
    expect(status.identity?.source).toBe('idp')
    expect(status.identity?.session?.cached).toBe(true)
    expect(status.identity?.session?.expired).toBe(true)
    expect(status.identity?.session?.hasRefreshToken).toBe(true)
  })

  test('falls back to identity exp claim when IdP session has no expires_at', async () => {
    const identities: IdentityStore = {
      default: 'workos-user',
      identities: {
        'workos-user': {
          subject: 'user_123',
          source: 'idp',
          mode: 'remote',
          idp: 'workos',
          issuer: 'https://idp.example.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          claims: { exp: 946684800 },
        },
      },
    }
    const session: IdpSession = {
      identity: 'workos-user',
      idp: 'workos',
      issuer: 'https://idp.example.com',
      subject: 'user_123',
      access_token: 'redacted',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    const status = await buildLocalStatus(
      { active: '', instances: {} },
      identities,
      async () => session,
    )

    expect(status.identity?.session?.expiresAt).toBe('2000-01-01T00:00:00.000Z')
    expect(status.identity?.session?.expired).toBe(true)
  })
})

describe('decodeJwtExpiration', () => {
  test('decodes exp without exposing token content', async () => {
    const b64u = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const token = `${b64u({ alg: 'none' })}.${b64u({ exp: 946684800 })}.signature`

    const expiration = decodeJwtExpiration(token, Date.parse('2026-01-01T00:00:00.000Z'))

    expect(expiration).toEqual({
      expiresAt: '2000-01-01T00:00:00.000Z',
      expired: true,
    })
  })
})
