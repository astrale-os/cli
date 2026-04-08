import { describe, expect, test } from 'bun:test'

import { AstraleConfigSchema } from '../config'

describe('AstraleConfigSchema', () => {
  test('parses valid config', () => {
    const result = AstraleConfigSchema.parse({
      managerPort: 5000,
      falkorPort: 7000,
      uiPort: 5300,
      graphName: 'test-graph',
      issuer: 'https://test.astrale.ai',
    })
    expect(result.managerPort).toBe(5000)
    expect(result.graphName).toBe('test-graph')
  })

  test('applies defaults for empty object', () => {
    const result = AstraleConfigSchema.parse({})
    expect(result.managerPort).toBe(4400)
    expect(result.falkorPort).toBe(6379)
    expect(result.uiPort).toBe(4300)
    expect(result.graphName).toBe('astrale-manager')
    expect(result.issuer).toBe('http://localhost:4400/mngt')
  })

  test('rejects invalid port type', () => {
    expect(() => AstraleConfigSchema.parse({ managerPort: 'not-a-number' })).toThrow()
  })

  test('rejects negative port', () => {
    expect(() => AstraleConfigSchema.parse({ managerPort: -1 })).toThrow()
  })

  test('rejects non-url issuer', () => {
    expect(() => AstraleConfigSchema.parse({ issuer: 'not-a-url' })).toThrow()
  })

  test('allows partial config with defaults filled in', () => {
    const result = AstraleConfigSchema.parse({ managerPort: 9000 })
    expect(result.managerPort).toBe(9000)
    expect(result.falkorPort).toBe(6379)
  })
})
