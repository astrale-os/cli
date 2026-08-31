import { describe, expect, test } from 'bun:test'

import type { AstraleConfig } from '../config'
import type { InstanceStore } from '../instance'

import { AdminInstanceNotFoundError } from '../../admin/instance/model'
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
    bryan: {
      url: 'https://bryan.eu.beta.astrale.ai/api',
      slug: 'bryan',
      name: 'bryan',
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
            state: 'ready',
          }),
        },
      ),
    ).resolves.toEqual({
      name: 'bryan',
      source: 'managed',
      url: 'https://bryan.eu.astrale.ai/api',
      kernelIssuer: 'https://bryan.eu.astrale.ai/api',
      domainIssuer: 'https://shell.astrale.ai',
    })
  })

  test('resolves a pre-exchange managed bookmark through the trusted route profile', async () => {
    await expect(
      resolveInstanceTarget(
        { source: 'name', name: 'bryan' },
        { config: DEFAULT_CONFIG, instances: store },
      ),
    ).resolves.toMatchObject({
      source: 'bookmark',
      kernelIssuer: 'https://bryan.eu.beta.astrale.ai/api',
      domainIssuer: 'https://shell.beta.astrale.ai',
    })
  })

  test('unknown slugs surface the original instance-not-found error', async () => {
    await expect(
      resolveInstanceTarget(
        { source: 'name', name: 'missing' },
        {
          config: DEFAULT_CONFIG,
          instances: emptyStore,
          managed: async () => {
            throw new AdminInstanceNotFoundError('missing')
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

  test('treats the owner-scoped Admin error as managed lookup not-found', () => {
    expect(isManagedInstanceNotFound(new AdminInstanceNotFoundError('admin'))).toBe(true)
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

describe('isManagedInstanceNotFound: unknown errors', () => {
  test('does not infer a miss from an InternalKernelError message', () => {
    const e = new Error('DISPATCH_FAILED: handler crashed')
    e.name = 'InternalKernelError'
    expect(isManagedInstanceNotFound(e)).toBe(false)
  })

  test('maps Admin token-exchange failure to INSTANCE_NOT_FOUND', async () => {
    const managed = async () => {
      throw new AstraleError(
        'TOKEN_EXCHANGE_SOURCE_INVALID',
        'The source identity credential has no valid expiration.',
      )
    }
    const opts = {
      config: DEFAULT_CONFIG,
      instances: { instances: {} },
      managed,
    } as unknown as Parameters<typeof resolveInstanceTarget>[1]
    await expect(
      resolveInstanceTarget({ source: 'name', name: 'ghost' }, opts),
    ).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' })
  })
})
