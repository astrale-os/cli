import { describe, expect, test } from 'bun:test'

import type { AstraleConfig } from '../config'
import type { InstanceStore } from '../instance'

import { DEFAULT_CONFIG } from '../config'
import {
  couldBeConfiguredAdminInstance,
  isManagedInstanceNotFound,
  resolveInstanceTarget,
} from '../instance-target'

const store: InstanceStore = {
  active: 'active-bookmark',
  instances: {
    'active-bookmark': {
      url: 'https://active.example.com/api',
      issuer: 'https://active-issuer.example.com',
      defaultIdentity: 'active-id',
    },
    admin: {
      url: 'https://bookmarked-admin.example.com/api',
      issuer: 'https://bookmarked-admin-issuer.example.com',
    },
  },
}

const emptyStore: InstanceStore = {
  active: '',
  instances: {},
}

const directAdminConfig: AstraleConfig = {
  ...DEFAULT_CONFIG,
  admin: {
    name: 'admin',
    url: 'https://admin.eu.astrale.ai/api',
    issuer: 'https://admin.eu.astrale.ai/api',
  },
}

describe('resolveInstanceTarget', () => {
  test('bookmark names win over configured admin and managed lookup', async () => {
    const managedCalls: string[] = []

    await expect(
      resolveInstanceTarget(
        { source: 'name', name: 'admin' },
        {
          config: directAdminConfig,
          instances: store,
          managed: async (slug) => {
            managedCalls.push(slug)
            throw new Error('should not run')
          },
        },
      ),
    ).resolves.toMatchObject({
      name: 'admin',
      source: 'bookmark',
      url: 'https://bookmarked-admin.example.com/api',
    })
    expect(managedCalls).toEqual([])
  })

  test('configured admin resolves before managed lookup', async () => {
    const managedCalls: string[] = []

    await expect(
      resolveInstanceTarget(
        { source: 'name', name: 'admin' },
        {
          config: directAdminConfig,
          instances: emptyStore,
          managed: async (slug) => {
            managedCalls.push(slug)
            throw new Error('should not run')
          },
        },
      ),
    ).resolves.toMatchObject({
      name: 'admin',
      source: 'admin',
      url: 'https://admin.eu.astrale.ai/api',
      issuer: 'https://admin.eu.astrale.ai/api',
    })
    expect(managedCalls).toEqual([])
  })

  test('active resolves through the same named-instance path', async () => {
    await expect(
      resolveInstanceTarget({ source: 'active' }, { config: DEFAULT_CONFIG, instances: store }),
    ).resolves.toMatchObject({
      name: 'active-bookmark',
      source: 'bookmark',
      defaultIdentity: 'active-id',
    })
  })

  test('managed slug resolves through injected Instance.info lookup', async () => {
    await expect(
      resolveInstanceTarget(
        { source: 'name', name: 'bryan' },
        {
          config: DEFAULT_CONFIG,
          instances: emptyStore,
          managed: async (slug) => ({
            id: 'node-1',
            slug,
            url: `https://${slug}.eu.astrale.ai`,
          }),
        },
      ),
    ).resolves.toEqual({
      name: 'bryan',
      source: 'managed',
      url: 'https://bryan.eu.astrale.ai/api',
      issuer: 'https://bryan.eu.astrale.ai/api',
    })
  })

  test('unknown slugs surface the original instance-not-found error', async () => {
    const notFound = new Error('Path not found: "/admin/instances/missing"')
    notFound.name = 'NotFoundError'

    await expect(
      resolveInstanceTarget(
        { source: 'name', name: 'missing' },
        {
          config: DEFAULT_CONFIG,
          instances: emptyStore,
          managed: async () => {
            throw notFound
          },
        },
      ),
    ).rejects.toThrow('Instance "missing" is not bookmarked')
  })

  test('url targets do not receive an instance name by default', async () => {
    await expect(
      resolveInstanceTarget(
        { source: 'url', url: 'https://kernel.example.com/api' },
        { config: DEFAULT_CONFIG },
      ),
    ).resolves.toEqual({
      source: 'url',
      url: 'https://kernel.example.com/api',
      issuer: 'https://kernel.example.com/api',
      name: undefined,
    })
  })
})

describe('instance target helpers', () => {
  test('recognizes direct and bookmarked admin config names', () => {
    expect(couldBeConfiguredAdminInstance('admin', directAdminConfig)).toBe(true)
    expect(
      couldBeConfiguredAdminInstance('ops-admin', {
        ...DEFAULT_CONFIG,
        admin: { instance: 'ops-admin' },
      }),
    ).toBe(true)
    expect(couldBeConfiguredAdminInstance('bryan', directAdminConfig)).toBe(false)
  })

  test('treats wrapped remote Instance.info misses as managed lookup not-found', () => {
    const wrapped = new Error('Path not found: "/admin/instances/admin"') as Error & {
      data?: unknown
    }
    wrapped.name = 'KernelError'
    wrapped.data = { type: 'NotFoundError' }

    expect(isManagedInstanceNotFound(wrapped)).toBe(true)
  })

  test('does not hide non-not-found managed lookup failures', () => {
    const auth = new Error('permission denied')
    auth.name = 'PermissionDeniedError'

    expect(isManagedInstanceNotFound(auth)).toBe(false)
  })
})
