import { describe, expect, test } from 'bun:test'

import type { IdentityStore } from '../../identity/index'

import { AuthError } from '../../errors'
import { findOwnedInstance, type OwnedInstanceInfo } from '../../lib/admin-instance'
import {
  assertInstanceCreateIdentity,
  selectInstanceCreateIdentity,
} from '../../lib/provision-instance'

describe('admin-backed instance commands', () => {
  test('findOwnedInstance matches owner inventory by slug or stable node id', () => {
    const owned = {
      id: 'instance-node',
      slug: 'demo',
      url: 'https://demo.eu.astrale.ai',
      state: 'failed',
      organizationId: 'org_123',
      phase: 'installing:default-domains',
      error: 'postInstall failed',
      createdAt: '2026-07-16T00:00:00.000Z',
    } satisfies OwnedInstanceInfo

    expect(findOwnedInstance([owned], 'demo')).toBe(owned)
    expect(findOwnedInstance([owned], 'instance-node')).toBe(owned)
    expect(findOwnedInstance([owned], 'other')).toBeUndefined()
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

    expect(() => assertInstanceCreateIdentity(store)).toThrow(AuthError)
    expect(() => assertInstanceCreateIdentity(store)).toThrow('WorkOS login required')
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

    expect(() => assertInstanceCreateIdentity(store)).not.toThrow()
    expect(selectInstanceCreateIdentity(store)).toBe('bryan')
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

    expect(() => assertInstanceCreateIdentity(store, { as: 'local' })).toThrow(AuthError)
    expect(() => assertInstanceCreateIdentity(store, { as: 'workos' })).not.toThrow()
    expect(selectInstanceCreateIdentity(store, { as: 'workos' })).toBe('workos')
  })
})
