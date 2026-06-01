import { describe, expect, test } from 'bun:test'

import { InstanceStoreSchema } from '../instance'

describe('InstanceStoreSchema', () => {
  test('parses valid store with url', () => {
    const result = InstanceStoreSchema.parse({
      active: 'prod',
      instances: {
        prod: { url: 'https://prod.example.com', createdAt: '2024-01-01T00:00:00Z' },
      },
    })
    expect(result.active).toBe('prod')
    expect(result.instances.prod.url).toBe('https://prod.example.com')
  })

  test('parses legacy instance without url for migration compatibility', () => {
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
        local: { url: 'https://local.example.com', createdAt: '2024-01-01T00:00:00Z' },
        prod: { url: 'https://prod.example.com', createdAt: '2024-06-01T00:00:00Z' },
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
    // `createdAt` is metadata; the connection URL is the only required
    // field for a usable bookmark.
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
