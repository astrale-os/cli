import { describe, expect, test } from 'bun:test'

import { InstanceStoreSchema } from '../instance'

describe('InstanceStoreSchema', () => {
  test('parses valid store with url', () => {
    const result = InstanceStoreSchema.parse({
      active: 'manager',
      instances: {
        manager: { url: 'http://localhost:4400/mngt', createdAt: '2024-01-01T00:00:00Z' },
      },
    })
    expect(result.active).toBe('manager')
    expect(result.instances.manager.url).toBe('http://localhost:4400/mngt')
  })

  test('parses local instance without url', () => {
    const result = InstanceStoreSchema.parse({
      active: 'dev',
      instances: {
        dev: { createdAt: '2024-01-01T00:00:00Z' },
      },
    })
    expect(result.instances.dev.url).toBeUndefined()
  })

  test('parses multiple instances', () => {
    const result = InstanceStoreSchema.parse({
      active: 'prod',
      instances: {
        local: { createdAt: '2024-01-01T00:00:00Z' },
        prod: { url: 'http://prod:4400/mngt', createdAt: '2024-06-01T00:00:00Z' },
      },
    })
    expect(Object.keys(result.instances)).toHaveLength(2)
  })

  test('rejects missing active field', () => {
    expect(() =>
      InstanceStoreSchema.parse({
        instances: { m: { createdAt: '2024-01-01' } },
      }),
    ).toThrow()
  })

  test('accepts instance without createdAt (optional at schema level)', () => {
    // `createdAt` is intentionally optional on InstanceEntrySchema: only
    // `bookmark` entries persist it; `manager` / `local-child` derive it
    // live and omit it from instances.json (see lib/instance.ts).
    const result = InstanceStoreSchema.parse({
      active: 'm',
      instances: { m: { url: 'http://test' } },
    })
    expect(result.instances.m.createdAt).toBeUndefined()
  })

  test('accepts empty instances record', () => {
    const result = InstanceStoreSchema.parse({
      active: 'none',
      instances: {},
    })
    expect(Object.keys(result.instances)).toHaveLength(0)
  })
})
