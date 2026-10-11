import { describe, expect, test } from 'bun:test'

import type { AstraleConfig } from '../config'
import type { InstanceStore } from '../instance/bookmarks'

import { AdminInstanceNotFoundError } from '../../admin/instance/model'
import { AstraleError } from '../../errors'
import { DEFAULT_CONFIG } from '../config'
import { resolveInstanceTarget } from '../instance/target'

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
      url: 'https://bryan.eu.astrale.ai/api',
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
    domainIssuer: 'https://admin.astrale.ai',
  },
}

const refuse = async (): Promise<never> => {
  throw new Error('the managed lookup must not run')
}
const named = (
  name: string,
  instances: InstanceStore,
  managed: Parameters<typeof resolveInstanceTarget>[1]['managed'] = refuse,
  config = DEFAULT_CONFIG,
) => resolveInstanceTarget({ source: 'name', name }, { config, instances, managed })

describe('resolveInstanceTarget', () => {
  test('a bookmark name wins over the configured Admin, which wins over managed lookup', async () => {
    expect(await named('admin', store, refuse, directAdminConfig)).toMatchObject({
      name: 'admin',
      source: 'bookmark',
      url: 'https://bookmarked-admin.example.com/api',
    })
    expect(await named('admin', emptyStore, refuse, directAdminConfig)).toMatchObject({
      source: 'admin',
      url: 'https://admin.eu.astrale.ai/api',
      domainIssuer: 'https://admin.astrale.ai',
    })
    // The active instance resolves through the same named-instance path.
    expect(
      await resolveInstanceTarget(
        { source: 'active' },
        { config: DEFAULT_CONFIG, instances: store },
      ),
    ).toMatchObject({ name: 'active-bookmark', source: 'bookmark', defaultIdentity: 'active-id' })
  })

  test('a managed slug resolves through the managed lookup, exchanged through the installed Shell', async () => {
    const managed = async (slug: string) => ({
      id: 'node-1',
      slug,
      url: `https://${slug}.eu.astrale.ai`,
      state: 'ready' as const,
    })
    expect(await named('bryan', emptyStore, managed)).toEqual({
      name: 'bryan',
      source: 'managed',
      url: 'https://bryan.eu.astrale.ai/api',
      kernelIssuer: 'https://bryan.eu.astrale.ai/api',
      domainOrigin: 'shell.astrale.ai',
    })
  })

  test('a managed bookmark exchanges through the installed Shell, or at the exact issuer its user set', async () => {
    const shell = await named('bryan', store)
    expect(shell).toMatchObject({ source: 'bookmark', domainOrigin: 'shell.astrale.ai' })
    expect(shell).not.toHaveProperty('domainIssuer')

    const bryan = { ...store.instances.bryan!, domainIssuer: 'https://shell-dev.example' }
    const explicit = await named('bryan', { active: 'bryan', instances: { bryan } })
    expect(explicit).toMatchObject({
      source: 'bookmark',
      domainIssuer: 'https://shell-dev.example',
    })
    expect(explicit).not.toHaveProperty('domainOrigin')
  })

  test.each([
    ['an Admin miss', new AdminInstanceNotFoundError('ghost'), 'INSTANCE_NOT_FOUND'],
    [
      'an Admin token exchange failure',
      new AstraleError('TOKEN_EXCHANGE_SOURCE_INVALID', 'No valid expiration.'),
      'INSTANCE_NOT_FOUND',
    ],
    ['any other failure', new AstraleError('PERMISSION_DENIED', 'Denied.'), 'PERMISSION_DENIED'],
  ])('a managed lookup answering %s reads as %s', async (_name, failure, code) => {
    const lookup = async (): Promise<never> => {
      throw failure
    }
    await expect(named('ghost', emptyStore, lookup)).rejects.toMatchObject({ code })
  })
})
