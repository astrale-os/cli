import { describe, expect, test } from 'bun:test'

import type { InstanceStore } from '../instance'

import {
  DEFAULT_ADMIN_TARGET_NAME,
  DEFAULT_ADMIN_DOMAIN_ISSUER,
  DEFAULT_ADMIN_TARGET_URL,
  resolveAdminTargetFromStore,
} from '../admin-target'
import { DEFAULT_CONFIG, type AstraleConfig } from '../config'
import { sanitizeStore } from '../instance'

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

describe('resolveAdminTargetFromStore', () => {
  test('defaults to the hosted production Admin', () => {
    expect(DEFAULT_ADMIN_TARGET_URL).toBe('https://admin.eu.astrale.ai/api')
    expect(DEFAULT_ADMIN_DOMAIN_ISSUER).toBe('https://admin.astrale.ai')
  })

  test('uses hosted admin default without active instance coupling', () => {
    expect(resolveAdminTargetFromStore({}, DEFAULT_CONFIG, instances)).toEqual({
      name: DEFAULT_ADMIN_TARGET_NAME,
      registrationSlug: DEFAULT_ADMIN_TARGET_NAME,
      url: DEFAULT_ADMIN_TARGET_URL,
      kernelIssuer: DEFAULT_ADMIN_TARGET_URL,
      domainIssuer: DEFAULT_ADMIN_DOMAIN_ISSUER,
      source: 'default',
      configured: false,
    })
  })

  test('uses configured admin bookmark', () => {
    const config: AstraleConfig = {
      ...DEFAULT_CONFIG,
      admin: { instance: 'admin' },
    }

    expect(resolveAdminTargetFromStore({}, config, instances)).toEqual({
      name: 'admin',
      registrationSlug: 'admin',
      url: 'https://bookmarked-admin.example.com',
      kernelIssuer: 'https://bookmarked-issuer.example.com',
      domainIssuer: 'https://bookmarked-domain.example.com',
      defaultIdentity: 'admin-workos',
      source: 'config-instance',
      configured: true,
    })
  })

  test('keeps an exact Domain issuer separate from the Admin Kernel target', () => {
    const config: AstraleConfig = {
      ...DEFAULT_CONFIG,
      admin: {
        url: 'https://admin.eu.astrale.ai/api',
        kernelIssuer: 'https://admin.eu.astrale.ai/api',
        domainIssuer: 'https://admin.astrale.ai',
      },
    }

    expect(resolveAdminTargetFromStore({}, config, instances)).toMatchObject({
      url: 'https://admin.eu.astrale.ai/api',
      kernelIssuer: 'https://admin.eu.astrale.ai/api',
      domainIssuer: 'https://admin.astrale.ai',
      source: 'config-url',
      configured: true,
    })

    expect(
      resolveAdminTargetFromStore(
        { adminUrl: 'https://override.eu.astrale.ai/api' },
        config,
        instances,
      ),
    ).toMatchObject({
      url: 'https://override.eu.astrale.ai/api',
      domainIssuer: 'https://admin.astrale.ai',
    })
  })

  test('allows explicit admin bookmark and admin url overrides', () => {
    expect(
      resolveAdminTargetFromStore({ admin: 'alias' }, DEFAULT_CONFIG, instances),
    ).toMatchObject({
      name: 'alias',
      url: 'https://alias-admin.example.com',
      kernelIssuer: 'https://alias-admin.example.com',
      domainIssuer: 'https://alias-domain.example.com',
      source: 'admin',
    })

    expect(
      resolveAdminTargetFromStore(
        {
          adminUrl: 'https://override-admin.example.com',
          domainIssuer: 'https://override-domain.example.com',
        },
        DEFAULT_CONFIG,
        instances,
      ),
    ).toMatchObject({
      name: 'admin',
      url: 'https://override-admin.example.com',
      kernelIssuer: 'https://override-admin.example.com',
      domainIssuer: 'https://override-domain.example.com',
      source: 'admin-url',
    })
  })

  test.each([
    [{ instance: 'pace' }, '-i/--instance selects an instance, not the Admin kernel.'],
    [{ url: 'https://pace.example.com/api' }, '--url selects an instance, not the Admin kernel.'],
    [
      { instance: 'pace', url: 'https://pace.example.com/api' },
      '-i/--instance and --url select an instance, not the Admin kernel.',
    ],
  ])('rejects instance selectors as Admin kernel overrides (%o)', (opts, message) => {
    expect(() => resolveAdminTargetFromStore(opts, DEFAULT_CONFIG, instances)).toThrow(message)
  })

  test('points instance selectors at the Admin flags', () => {
    try {
      resolveAdminTargetFromStore({ instance: 'pace' }, DEFAULT_CONFIG, instances)
      throw new Error('expected rejection')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'INVALID_FLAG',
        hint: 'Use --admin <bookmark> or --admin-url <url> to choose the Admin kernel for this operation.',
      })
    }
  })

  test('still resolves --admin and --admin-url', () => {
    expect(
      resolveAdminTargetFromStore({ admin: 'admin' }, DEFAULT_CONFIG, instances),
    ).toMatchObject({ name: 'admin', url: 'https://bookmarked-admin.example.com', source: 'admin' })
    expect(
      resolveAdminTargetFromStore(
        {
          adminUrl: 'https://override.example.com',
          domainIssuer: 'https://override-domain.example.com',
        },
        DEFAULT_CONFIG,
        instances,
      ),
    ).toMatchObject({ url: 'https://override.example.com', source: 'admin-url' })
  })

  test('rejects conflicting admin target overrides', () => {
    expect(() =>
      resolveAdminTargetFromStore(
        { admin: 'admin', adminUrl: 'https://override-admin.example.com' },
        DEFAULT_CONFIG,
        instances,
      ),
    ).toThrow('Choose one admin target override')
  })

  test('retains configured Domain evidence instead of inferring it from the Kernel issuer', () => {
    expect(
      resolveAdminTargetFromStore(
        { adminUrl: 'https://override-admin.example.com' },
        DEFAULT_CONFIG,
        instances,
      ),
    ).toMatchObject({
      kernelIssuer: 'https://override-admin.example.com',
      domainIssuer: DEFAULT_ADMIN_DOMAIN_ISSUER,
    })
  })

  /** @evidence TEST-CLI-ADMIN-REGISTRY-ISSUER-KEPT */
  test('keeps an explicit issuer for Admin calls through a parsed bookmark', () => {
    const url = 'https://bryan.eu.astrale.ai/api'
    // Every bookmark store reaches Admin resolution through the registry read.
    const { store } = sanitizeStore({
      active: 'bryan',
      instances: {
        bryan: {
          url,
          issuer: url,
          domainIssuer: 'https://shell.beta.astrale.ai',
          slug: 'bryan',
          name: 'bryan',
          kind: 'bookmark',
        },
      },
    })

    expect(resolveAdminTargetFromStore({ admin: 'bryan' }, DEFAULT_CONFIG, store)).toMatchObject({
      url,
      domainIssuer: 'https://shell.beta.astrale.ai',
      source: 'admin',
    })

    expect(
      resolveAdminTargetFromStore({}, { ...DEFAULT_CONFIG, admin: { instance: 'bryan' } }, store),
    ).toMatchObject({
      url,
      domainIssuer: 'https://shell.beta.astrale.ai',
      source: 'config-instance',
    })
  })
})
