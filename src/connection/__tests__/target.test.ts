import { issuer } from '@astrale-os/sdk/auth'
import { describe, expect, test } from 'bun:test'

import type { AstraleConfig } from '../../lib/config'
import type { InstanceStore } from '../../lib/instance'

import { resolveAdminConnectionTarget, resolveConnectionTarget } from '../target'

const config: AstraleConfig = {
  issuer: 'https://cli.example',
  admin: {
    name: 'control',
    url: 'https://admin.example/api',
    issuer: 'https://admin.example/issuer',
  },
  telemetry: { enabled: false },
}

const instances: InstanceStore = {
  active: 'staging',
  instances: {
    staging: {
      url: 'https://staging.example/api',
      issuer: 'https://identity.staging.example',
      defaultIdentity: 'alice',
      caFile: '/etc/astrale/staging-ca.pem',
    },
  },
}

describe('connection target', () => {
  /** @evidence TEST-CLI-CONNECTION-SELECTS-EXACT-TARGET */
  test('preserves URL, bookmark, active, managed, and Admin target semantics', async () => {
    expect(
      await resolveConnectionTarget({ url: 'https://direct.example/invoke' }, config, {
        instances,
      }),
    ).toEqual({
      url: 'https://direct.example/invoke',
      issuer: issuer.accept('https://direct.example/invoke'),
    })

    expect(await resolveConnectionTarget({}, config, { instances })).toEqual({
      url: 'https://staging.example/api',
      issuer: issuer.accept('https://identity.staging.example'),
      slug: 'staging',
      defaultIdentity: 'alice',
      caFile: '/etc/astrale/staging-ca.pem',
    })

    expect(
      await resolveConnectionTarget(
        { instance: 'staging', url: 'https://override.example/invoke' },
        config,
        { instances },
      ),
    ).toMatchObject({
      url: 'https://override.example/invoke',
      issuer: 'https://identity.staging.example',
      slug: 'staging',
    })

    expect(
      await resolveConnectionTarget({ instance: 'remote' }, config, {
        instances,
        managed: async (slug) => ({
          id: 'managed-id',
          slug,
          url: 'https://managed.example',
        }),
      }),
    ).toEqual({
      url: 'https://managed.example',
      issuer: issuer.accept('https://managed.example'),
      slug: 'remote',
    })

    expect(await resolveConnectionTarget({ instance: 'control' }, config, { instances })).toEqual({
      url: 'https://admin.example/api',
      issuer: issuer.accept('https://admin.example/issuer'),
      slug: 'control',
    })

    expect(await resolveAdminConnectionTarget({}, config, instances)).toEqual({
      url: 'https://admin.example/api',
      issuer: issuer.accept('https://admin.example/issuer'),
      slug: 'control',
    })
  })
})
