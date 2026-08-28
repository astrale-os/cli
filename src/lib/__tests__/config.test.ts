import { describe, expect, test } from 'bun:test'

import { DEFAULT_ADMIN_DOMAIN_ISSUER, DEFAULT_ADMIN_TARGET_URL } from '../admin-target'
import { AstraleConfigSchema } from '../config'

describe('AstraleConfigSchema', () => {
  test('parses valid config', () => {
    const result = AstraleConfigSchema.parse({
      issuer: 'https://test.astrale.ai',
    })
    expect(result.issuer).toBe('https://test.astrale.ai')
    expect(result.admin.url).toBe(DEFAULT_ADMIN_TARGET_URL)
  })

  test('applies defaults for empty object', () => {
    const result = AstraleConfigSchema.parse({})
    expect(result.issuer).toBe('https://unregistered.invalid')
    expect(result.admin).toEqual({
      name: 'admin',
      url: DEFAULT_ADMIN_TARGET_URL,
      kernelIssuer: DEFAULT_ADMIN_TARGET_URL,
      domainIssuer: DEFAULT_ADMIN_DOMAIN_ISSUER,
    })
    expect(result.telemetry).toEqual({ enabled: true, analyzerEnabled: false })
  })

  test('retention bounds survive a parse — a read/write cycle must not drop them', () => {
    // zod strips unknown keys, so a bound declared only in its reader would be
    // silently erased by any command that rewrites the config.
    const result = AstraleConfigSchema.parse({
      telemetry: { enabled: true, maxAgeDays: 7, maxBytes: 1_048_576 },
      browser: { maxCacheBytes: 52_428_800, maxProfileAgeDays: 14 },
    })
    expect(result.telemetry).toEqual({
      enabled: true,
      analyzerEnabled: false,
      maxAgeDays: 7,
      maxBytes: 1_048_576,
    })
    expect(result.browser).toEqual({ maxCacheBytes: 52_428_800, maxProfileAgeDays: 14 })
  })

  test.each([
    ['zero', 0],
    ['negative', -5],
    ['not a number', 'lots'],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('a %s bound is dropped, and does not take the rest of the config with it', (_l, value) => {
    const result = AstraleConfigSchema.parse({
      issuer: 'https://test.astrale.ai',
      telemetry: { enabled: true, maxAgeDays: value },
      browser: { maxCacheBytes: value },
    })
    expect(result.telemetry.maxAgeDays).toBeUndefined()
    expect(result.browser.maxCacheBytes).toBeUndefined()
    expect(result.issuer).toBe('https://test.astrale.ai')
  })

  test('rejects non-url issuer', () => {
    expect(() => AstraleConfigSchema.parse({ issuer: 'not-a-url' })).toThrow()
  })

  test('strips removed local-runtime config keys', () => {
    const result = AstraleConfigSchema.parse({
      issuer: 'https://test.astrale.ai',
      managerPort: 9000,
      removedRuntimeKey: true,
    })
    expect('managerPort' in result).toBe(false)
    expect('removedRuntimeKey' in result).toBe(false)
  })

  test('accepts configured admin bookmark', () => {
    const result = AstraleConfigSchema.parse({
      admin: { instance: 'staging-admin' },
    })
    expect(result.admin).toEqual({ instance: 'staging-admin' })
  })

  test('rejects admin config with url and instance together', () => {
    expect(() =>
      AstraleConfigSchema.parse({
        admin: { url: DEFAULT_ADMIN_TARGET_URL, instance: 'admin' },
      }),
    ).toThrow()
  })
})
