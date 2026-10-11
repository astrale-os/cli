import { describe, expect, test } from 'bun:test'

import type { IdentityStore } from '../../identity/index'
import type { IdpSession } from '../idp/provider'
import type { InstanceStore } from '../instance/bookmarks'

import { DEFAULT_ADMIN_TARGET_URL } from '../admin/target'
import { buildLocalStatus } from '../local-status'

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
    }
    expect(status.identity?.name).toBe('alice')
    expect(status.identity?.source).toBe('key')
    expect(status.identity?.session).toBeNull()
  })

  test('an IdP session with a stale token needs a login only when it cannot refresh', async () => {
    const identities: IdentityStore = {
      default: 'workos-user',
      identities: {
        'workos-user': {
          subject: 'user_123',
          source: 'idp',
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
      expires_at: '2000-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const status = (cached: IdpSession) =>
      buildLocalStatus({ active: '', instances: {} }, identities, async () => cached)

    expect((await status({ ...session, refresh_token: 'refresh' })).identity?.session).toEqual({
      cached: true,
      requiresLogin: false,
      hasRefreshToken: true,
    })
    expect((await status(session)).identity?.session).toEqual({
      cached: true,
      requiresLogin: true,
      hasRefreshToken: false,
    })
    // Without a recorded expiry, the session's own exp claim decides.
    const { expires_at: _recorded, ...unrecorded } = session
    expect(
      (await status({ ...unrecorded, claims: { exp: 946_684_800 } })).identity?.session,
    ).toMatchObject({ requiresLogin: true })
  })
})
