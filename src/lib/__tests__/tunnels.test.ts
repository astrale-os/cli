import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { TunnelStoreSchema, findTunnel, type TunnelStore } from '../tunnels'

function makeStore(): TunnelStore {
  return TunnelStoreSchema.parse({
    tunnels: {
      astrale: {
        id: 'abc-123',
        name: 'astrale',
        adapter: 'cloudflared',
        hostname: 'astrale.local.astrale.ai',
        createdAt: '2025-01-01T00:00:00Z',
      },
      secondary: {
        id: 'def-456',
        name: 'secondary',
        adapter: 'cloudflared',
        hostname: 'secondary.local.astrale.ai',
        boundInstance: 'test',
        createdAt: '2025-01-02T00:00:00Z',
      },
    },
  })
}

describe('SPEC V3 — tunnel registry', () => {
  test('findTunnel by name', () => {
    const s = makeStore()
    expect(findTunnel(s, 'astrale')?.id).toBe('abc-123')
  })

  test('findTunnel by id', () => {
    const s = makeStore()
    expect(findTunnel(s, 'def-456')?.name).toBe('secondary')
  })

  test('findTunnel returns undefined on miss', () => {
    const s = makeStore()
    expect(findTunnel(s, 'nope')).toBeUndefined()
  })

  test('schema rejects entry missing id', () => {
    expect(() =>
      TunnelStoreSchema.parse({
        tunnels: { x: { name: 'x', adapter: 'cf', hostname: 'x', createdAt: '' } },
      }),
    ).toThrow()
  })

  test('schema accepts boundInstance optional', () => {
    const s = TunnelStoreSchema.parse({
      tunnels: {
        a: { id: 'i', name: 'a', adapter: 'cf', hostname: 'h', createdAt: 't' },
      },
    })
    expect(s.tunnels.a.boundInstance).toBeUndefined()
  })
})
