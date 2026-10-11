import { describe, expect, test } from 'bun:test'

import { DEFAULT_ADMIN_DOMAIN_ISSUER } from '../admin-target'
import { AstraleConfigSchema } from '../config'

describe('AstraleConfigSchema', () => {
  test('defaults to the hosted Admin target', () => {
    expect(AstraleConfigSchema.parse({}).admin).toEqual({
      name: 'admin',
      url: 'https://admin.eu.astrale.ai/api',
      kernelIssuer: 'https://admin.eu.astrale.ai/api',
      domainIssuer: DEFAULT_ADMIN_DOMAIN_ISSUER,
    })
  })

  test('keeps retention bounds through a rewrite and drops only an invalid bound', () => {
    const result = AstraleConfigSchema.parse({
      issuer: 'https://test.astrale.ai',
      telemetry: { enabled: true, maxAgeDays: 7, maxBytes: -1 },
      browser: { maxCacheBytes: 52_428_800, maxProfileAgeDays: 'lots' },
    })
    expect(result.telemetry).toEqual({ enabled: true, analyzerEnabled: false, maxAgeDays: 7 })
    expect(result.browser).toEqual({ maxCacheBytes: 52_428_800 })
    expect(result.issuer).toBe('https://test.astrale.ai')
  })

  test('refuses an Admin target naming both a URL and a bookmark', () => {
    expect(() =>
      AstraleConfigSchema.parse({
        admin: { url: 'https://admin.example/api', instance: 'admin' },
      }),
    ).toThrow()
  })
})
