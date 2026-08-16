import { describe, expect, test } from 'bun:test'

import type { AstraleConfig } from '../config'
import type { InstanceStore } from '../instance'

import { AstraleError } from '../../errors'
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
      domainIssuer: 'https://bookmarked-admin-domain.example.com',
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
    kernelIssuer: 'https://admin.eu.astrale.ai/api',
    domainIssuer: 'https://admin.beta.astrale.ai',
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
      kernelIssuer: 'https://admin.eu.astrale.ai/api',
      domainIssuer: 'https://admin.beta.astrale.ai',
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

  test('managed slug resolves through the injected managed lookup', async () => {
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
      kernelIssuer: 'https://bryan.eu.astrale.ai/api',
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
      kernelIssuer: 'https://kernel.example.com/api',
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

  test('recognizes an owner-scoped lookup miss', () => {
    expect(
      isManagedInstanceNotFound(
        new AstraleError('INSTANCE_NOT_FOUND', 'No owned instance matches "missing".'),
      ),
    ).toBe(true)
  })
})

describe('isManagedInstanceNotFound: kernel InternalKernelError wrap', () => {
  test('NOT_FOUND-prefixed InternalKernelError is an instance miss', () => {
    const e = new Error('NOT_FOUND: no instance node for "knowledge"')
    e.name = 'InternalKernelError'
    expect(isManagedInstanceNotFound(e)).toBe(true)
  })
  test('other InternalKernelError messages are not swallowed', () => {
    const e = new Error('DISPATCH_FAILED: handler crashed')
    e.name = 'InternalKernelError'
    expect(isManagedInstanceNotFound(e)).toBe(false)
  })
  test('resolveNamedInstanceTarget maps the wrap to typed INSTANCE_NOT_FOUND', async () => {
    const managed = async () => {
      const e = new Error('NOT_FOUND: no instance node for "ghost"')
      e.name = 'InternalKernelError'
      throw e
    }
    const opts = {
      config: DEFAULT_CONFIG,
      instances: { instances: {} },
      managed,
    } as unknown as Parameters<typeof resolveInstanceTarget>[1]
    let caught: unknown
    try {
      await resolveInstanceTarget({ source: 'name', name: 'ghost' }, opts)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(AstraleError)
    expect((caught as AstraleError).code).toBe('INSTANCE_NOT_FOUND')
  })
})
