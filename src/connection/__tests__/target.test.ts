import { issuer } from '@astrale-os/sdk/auth'
import { describe, expect, test } from 'bun:test'

import type { AstraleConfig } from '../../lib/config'
import type { InstanceStore } from '../../lib/instance'

import {
  registrationKeyForTarget,
  resolveAdminConnectionTarget,
  resolveConnectionTarget,
} from '../target'

const config: AstraleConfig = {
  issuer: 'https://cli.example',
  admin: {
    name: 'control',
    url: 'https://admin.example/api',
    kernelIssuer: 'https://admin.example/issuer',
    domainIssuer: 'https://admin-domain.example',
  },
  telemetry: { enabled: false, analyzerEnabled: false },
  browser: {},
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
  test('shares registrations across aliases and transports only for the same Kernel issuer', () => {
    const kernelIssuer = issuer.accept('https://kernel.example/issuer')
    const original = { slug: 'first', url: 'https://kernel.example/api', kernelIssuer }
    const alias = { slug: 'second', url: 'https://proxy.example/invoke', kernelIssuer }
    const direct = { url: 'https://kernel.example/issuer', kernelIssuer }
    expect(registrationKeyForTarget(original)).toBe(kernelIssuer)
    expect(registrationKeyForTarget(alias)).toBe(registrationKeyForTarget(original))
    expect(registrationKeyForTarget(direct)).toBe(registrationKeyForTarget(original))
    expect(
      registrationKeyForTarget({
        ...original,
        kernelIssuer: issuer.accept('https://other.example'),
      }),
    ).not.toBe(kernelIssuer)
  })

  /** @evidence TEST-CLI-CONNECTION-SELECTS-EXACT-TARGET */
  test('preserves URL, bookmark, active, managed, and Admin target semantics', async () => {
    expect(
      await resolveConnectionTarget({ url: 'https://direct.example/invoke' }, config, {
        instances,
      }),
    ).toEqual({
      url: 'https://direct.example/invoke',
      kernelIssuer: issuer.accept('https://direct.example/invoke'),
    })

    expect(await resolveConnectionTarget({}, config, { instances })).toEqual({
      url: 'https://staging.example/api',
      kernelIssuer: issuer.accept('https://identity.staging.example'),
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
      kernelIssuer: 'https://identity.staging.example',
      slug: 'staging',
    })

    expect(
      await resolveConnectionTarget({ instance: 'remote' }, config, {
        instances,
        managed: async (slug) => ({
          id: 'managed-id',
          slug,
          url: 'https://managed.example',
          state: 'ready',
        }),
      }),
    ).toEqual({
      url: 'https://managed.example',
      kernelIssuer: issuer.accept('https://managed.example'),
      slug: 'remote',
    })

    expect(await resolveConnectionTarget({ instance: 'control' }, config, { instances })).toEqual({
      url: 'https://admin.example/api',
      kernelIssuer: issuer.accept('https://admin.example/issuer'),
      domainIssuer: issuer.accept('https://admin-domain.example'),
      slug: 'control',
    })

    expect(await resolveAdminConnectionTarget({}, config, instances)).toEqual({
      url: 'https://admin.example/api',
      kernelIssuer: issuer.accept('https://admin.example/issuer'),
      domainIssuer: issuer.accept('https://admin-domain.example'),
      slug: 'control',
    })
  })
})
