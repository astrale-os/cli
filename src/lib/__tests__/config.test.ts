import { describe, expect, test } from 'bun:test'

import { AstraleConfigSchema } from '../config'

describe('AstraleConfigSchema', () => {
  test('parses valid config', () => {
    const result = AstraleConfigSchema.parse({
      issuer: 'https://test.astrale.ai',
    })
    expect(result.issuer).toBe('https://test.astrale.ai')
  })

  test('applies defaults for empty object', () => {
    const result = AstraleConfigSchema.parse({})
    expect(result.issuer).toBe('https://identity.astrale.ai')
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
})
