import { describe, expect, mock, test } from 'bun:test'

import type { IdentityStore } from '../../identity/index'

import { AuthError } from '../../errors'
import {
  ADMIN_INSTANCE,
  adminInstanceMethod,
  callOwnedInstances,
  findOwnedInstance,
  type OwnedInstanceInfo,
} from '../../lib/admin-instance'
import { assertAlphaCreateIdentity } from '../instance/create'

describe('admin-backed instance commands', () => {
  test('target the merged Instance class', () => {
    expect(ADMIN_INSTANCE).toBe('/:admin.astrale.ai:class.Instance')
    expect(adminInstanceMethod('list')).toBe('/:admin.astrale.ai:class.Instance:list')
  })

  test('findOwnedInstance matches owner inventory by slug or stable node id', () => {
    const owned = {
      id: 'instance-node',
      slug: 'demo',
      url: 'https://demo.eu.astrale.ai',
      state: 'failed',
      organizationId: 'org_123',
      hostId: 'host-1',
      region: 'eu',
      phase: 'installing:default-domains',
      error: 'postInstall failed',
      createdAt: '2026-07-16T00:00:00.000Z',
    } satisfies OwnedInstanceInfo

    expect(findOwnedInstance([owned], 'demo')).toBe(owned)
    expect(findOwnedInstance([owned], 'instance-node')).toBe(owned)
    expect(findOwnedInstance([owned], 'other')).toBeUndefined()
  })

  test('owner-scoped discovery calls listMine with an empty input', async () => {
    const owned: OwnedInstanceInfo[] = [
      {
        id: 'instance-node',
        slug: 'demo',
        url: 'https://demo.eu.astrale.ai',
        state: 'ready',
      },
    ]
    const call = mock(async () => owned)

    await expect(callOwnedInstances({ call })).resolves.toEqual([
      {
        id: 'instance-node',
        slug: 'demo',
        url: 'https://demo.eu.astrale.ai',
        state: 'ready',
      },
    ])
    expect(call).toHaveBeenCalledWith('/:admin.astrale.ai:class.Instance:listMine', {})
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
