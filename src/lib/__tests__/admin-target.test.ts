import { describe, expect, test } from 'bun:test'

import type { InstanceStore } from '../instance'

import {
  DEFAULT_ADMIN_TARGET_NAME,
  DEFAULT_ADMIN_TARGET_URL,
  resolveAdminTargetFromStore,
} from '../admin-target'
import { DEFAULT_CONFIG, type AstraleConfig } from '../config'

const instances: InstanceStore = {
  active: 'workload',
  instances: {
    workload: {
      url: 'https://workload.example.com',
      issuer: 'https://workload-issuer.example.com',
    },
    admin: {
      url: 'https://bookmarked-admin.example.com',
      issuer: 'https://bookmarked-issuer.example.com',
    },
    alias: { url: 'https://alias-admin.example.com', name: 'named-admin' },
  },
}

describe('resolveAdminTargetFromStore', () => {
  test('uses hosted admin default without active instance coupling', () => {
    expect(resolveAdminTargetFromStore({}, DEFAULT_CONFIG, instances)).toEqual({
      name: DEFAULT_ADMIN_TARGET_NAME,
      registrationSlug: DEFAULT_ADMIN_TARGET_NAME,
      url: DEFAULT_ADMIN_TARGET_URL,
      issuer: DEFAULT_ADMIN_TARGET_URL,
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
      issuer: 'https://bookmarked-issuer.example.com',
      source: 'config-instance',
      configured: true,
    })
  })

  test('allows explicit admin bookmark and admin url overrides', () => {
    expect(
      resolveAdminTargetFromStore({ admin: 'alias' }, DEFAULT_CONFIG, instances),
    ).toMatchObject({
      name: 'alias',
      url: 'https://alias-admin.example.com',
      issuer: 'https://alias-admin.example.com',
      source: 'admin',
    })

    expect(
      resolveAdminTargetFromStore(
        { adminUrl: 'https://override-admin.example.com' },
        DEFAULT_CONFIG,
        instances,
      ),
    ).toMatchObject({
      name: 'admin',
      url: 'https://override-admin.example.com',
      issuer: 'https://override-admin.example.com',
      source: 'admin-url',
    })
  })

  test('keeps legacy -i and --url as admin target aliases', () => {
    expect(
      resolveAdminTargetFromStore({ instance: 'admin' }, DEFAULT_CONFIG, instances),
    ).toMatchObject({
      name: 'admin',
      url: 'https://bookmarked-admin.example.com',
      source: 'legacy-instance',
    })

    expect(
      resolveAdminTargetFromStore({ url: 'https://legacy.example.com' }, DEFAULT_CONFIG, instances),
    ).toMatchObject({
      name: 'admin',
      url: 'https://legacy.example.com',
      source: 'legacy-url',
    })
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
})
