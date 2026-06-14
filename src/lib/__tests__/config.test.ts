import { describe, expect, test } from 'bun:test'

import { DEFAULT_ADMIN_TARGET_URL } from '../admin-target'
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
      issuer: DEFAULT_ADMIN_TARGET_URL,
    })
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
