import { describe, expect, test } from 'bun:test'

import type { InstanceStore } from '../instance'

import {
  DEFAULT_ADMIN_TARGET_NAME,
  DEFAULT_ADMIN_DOMAIN_ISSUER,
  DEFAULT_ADMIN_TARGET_URL,
  resolveAdminTargetFromStore,
} from '../admin-target'
import { DEFAULT_CONFIG, type AstraleConfig } from '../config'

const instances: InstanceStore = {
  active: 'primary',
  instances: {
    primary: {
      url: 'https://primary.example.com',
      issuer: 'https://primary-issuer.example.com',
    },
    admin: {
      url: 'https://bookmarked-admin.example.com',
      issuer: 'https://bookmarked-issuer.example.com',
      domainIssuer: 'https://bookmarked-domain.example.com',
      defaultIdentity: 'admin-workos',
    },
    alias: {
      url: 'https://alias-admin.example.com',
      domainIssuer: 'https://alias-domain.example.com',
      name: 'named-admin',
    },
  },
}

const configured = (admin: AstraleConfig['admin']): AstraleConfig => ({ ...DEFAULT_CONFIG, admin })
const hosted = {
  url: 'https://admin.eu.astrale.ai/api',
  kernelIssuer: 'https://admin.eu.astrale.ai/api',
  domainIssuer: 'https://admin.astrale.ai',
}

describe('resolveAdminTargetFromStore', () => {
  test.each([
    [
      'the hosted default, whatever instance is active',
      {},
      DEFAULT_CONFIG,
      {
        name: DEFAULT_ADMIN_TARGET_NAME,
        registrationSlug: DEFAULT_ADMIN_TARGET_NAME,
        url: DEFAULT_ADMIN_TARGET_URL,
        kernelIssuer: DEFAULT_ADMIN_TARGET_URL,
        domainIssuer: DEFAULT_ADMIN_DOMAIN_ISSUER,
        source: 'default',
        configured: false,
      },
    ],
    [
      'the configured bookmark',
      {},
      configured({ instance: 'admin' }),
      {
        name: 'admin',
        registrationSlug: 'admin',
        url: 'https://bookmarked-admin.example.com',
        kernelIssuer: 'https://bookmarked-issuer.example.com',
        domainIssuer: 'https://bookmarked-domain.example.com',
        defaultIdentity: 'admin-workos',
        source: 'config-instance',
        configured: true,
      },
    ],
    [
      'the configured URL, its Domain issuer apart from the Kernel',
      {},
      configured(hosted),
      { ...hosted, source: 'config-url', configured: true },
    ],
    [
      'an Admin URL override, keeping the configured Domain issuer',
      { adminUrl: 'https://override.eu.astrale.ai/api' },
      configured(hosted),
      { url: 'https://override.eu.astrale.ai/api', domainIssuer: 'https://admin.astrale.ai' },
    ],
    [
      'an Admin URL without its own issuer, never taking the Kernel one',
      { adminUrl: 'https://override-admin.example.com' },
      DEFAULT_CONFIG,
      {
        kernelIssuer: 'https://override-admin.example.com',
        domainIssuer: DEFAULT_ADMIN_DOMAIN_ISSUER,
      },
    ],
    [
      'an Admin URL with its Domain issuer',
      {
        adminUrl: 'https://override-admin.example.com',
        domainIssuer: 'https://override-domain.example.com',
      },
      DEFAULT_CONFIG,
      {
        name: 'admin',
        url: 'https://override-admin.example.com',
        kernelIssuer: 'https://override-admin.example.com',
        domainIssuer: 'https://override-domain.example.com',
        source: 'admin-url',
      },
    ],
    [
      'an explicit bookmark',
      { admin: 'alias' },
      DEFAULT_CONFIG,
      {
        name: 'alias',
        url: 'https://alias-admin.example.com',
        kernelIssuer: 'https://alias-admin.example.com',
        domainIssuer: 'https://alias-domain.example.com',
        source: 'admin',
      },
    ],
  ] as const)('selects %s', (_name, opts, config, expected) => {
    expect(resolveAdminTargetFromStore(opts, config, instances)).toMatchObject(expected)
  })

  test.each([
    [{ instance: 'pace' }, '-i/--instance selects an instance, not the Admin kernel.'],
    [{ url: 'https://pace.example.com/api' }, '--url selects an instance, not the Admin kernel.'],
    [
      { instance: 'pace', url: 'https://pace.example.com/api' },
      '-i/--instance and --url select an instance, not the Admin kernel.',
    ],
    [
      { admin: 'admin', adminUrl: 'https://override-admin.example.com' },
      'Choose one admin target override',
    ],
  ])('refuses %o as an Admin kernel target', (opts, message) => {
    expect(() => resolveAdminTargetFromStore(opts, DEFAULT_CONFIG, instances)).toThrow(message)
  })

  /** @evidence TEST-CLI-ADMIN-REGISTRY-ISSUER-KEPT */
  test('keeps an explicit issuer for Admin calls through a parsed bookmark', () => {
    const expected = {
      url: 'https://bookmarked-admin.example.com',
      domainIssuer: 'https://bookmarked-domain.example.com',
    }
    expect(
      resolveAdminTargetFromStore({ admin: 'admin' }, DEFAULT_CONFIG, instances),
    ).toMatchObject({ ...expected, source: 'admin' })
    expect(
      resolveAdminTargetFromStore({}, configured({ instance: 'admin' }), instances),
    ).toMatchObject({ ...expected, source: 'config-instance' })
  })
})
