import { describe, expect, test } from 'bun:test'

import type { IdentityStore } from '../../lib/identity'

import { AuthError } from '../../errors'
import { ADMIN_INSTANCE } from '../../lib/admin-instance'
import { assertAlphaCreateIdentity } from '../instance/create'

describe('admin-backed instance commands', () => {
  test('target the merged Instance class', () => {
    expect(ADMIN_INSTANCE).toBe('/admin.astrale.ai/class.Instance')
  })

  test('instance create preflight points fresh installs at WorkOS login', () => {
    const store: IdentityStore = {
      default: 'manager',
      identities: {
        manager: {
          subject: 'manager',
          createdAt: '2026-06-08T00:00:00.000Z',
          source: 'key',
          mode: 'local',
        },
      },
    }

    expect(() => assertAlphaCreateIdentity(store)).toThrow(AuthError)
    expect(() => assertAlphaCreateIdentity(store)).toThrow('WorkOS login required')
  })

  test('instance create preflight accepts IdP-backed identities', () => {
    const store: IdentityStore = {
      default: 'bryan',
      identities: {
        bryan: {
          subject: 'user_123',
          createdAt: '2026-06-08T00:00:00.000Z',
          source: 'idp',
          mode: 'remote',
          idp: 'workos',
          issuer: 'https://auth.example.com',
        },
      },
    }

    expect(() => assertAlphaCreateIdentity(store)).not.toThrow()
  })

  test('--as selection must also be IdP-backed', () => {
    const store: IdentityStore = {
      default: 'local',
      identities: {
        local: {
          subject: 'local',
          createdAt: '2026-06-08T00:00:00.000Z',
          source: 'key',
          mode: 'local',
        },
        workos: {
          subject: 'user_123',
          createdAt: '2026-06-08T00:00:00.000Z',
          source: 'idp',
          mode: 'remote',
          idp: 'workos',
          issuer: 'https://auth.example.com',
        },
      },
    }

    expect(() => assertAlphaCreateIdentity(store, { as: 'local' })).toThrow(AuthError)
    expect(() => assertAlphaCreateIdentity(store, { as: 'workos' })).not.toThrow()
  })
})
