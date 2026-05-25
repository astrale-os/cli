import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

import { TunnelNotFoundError } from '../../errors'
import {
  IngressRuleSchema,
  TunnelStoreSchema,
  appendIngressRule,
  detachInstanceTunnels,
  findTunnel,
  parseTunnelStore,
  writeTunnels,
  type TunnelStore,
} from '../tunnels'

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

describe('DESIGN — tunnel registry', () => {
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

  test('IngressRuleSchema rejects non-URL service strings', () => {
    expect(() =>
      TunnelStoreSchema.parse({
        tunnels: {
          a: {
            id: 'i',
            name: 'a',
            adapter: 'cf',
            hostname: 'h',
            createdAt: 't',
            ingress: [{ hostname: 'h', service: 'not-a-url' }],
          },
        },
      }),
    ).toThrow()
  })
})

describe('parseTunnelStore — pure parser', () => {
  test('parses a valid registry', () => {
    const raw = JSON.stringify({
      tunnels: {
        foo: {
          id: 'abc-123',
          name: 'foo',
          adapter: 'cloudflared',
          hostname: 'foo.example.com',
          createdAt: '2026-05-20T00:00:00Z',
        },
      },
    })
    expect(parseTunnelStore(raw).tunnels.foo?.id).toBe('abc-123')
  })

  test('throws on corrupt JSON', () => {
    expect(() => parseTunnelStore('not valid json')).toThrow()
  })

  test('throws ZodError on schema mismatch', () => {
    const raw = JSON.stringify({ tunnels: { foo: { id: 'abc' } } })
    expect(() => parseTunnelStore(raw)).toThrow(z.ZodError)
  })

  test('throws on top-level shape mismatch (no `tunnels` key)', () => {
    expect(() => parseTunnelStore('{}')).toThrow()
  })
})

describe('appendIngressRule — pure in-place variant', () => {
  test('appends a new rule and returns duplicate=false', () => {
    const store = makeStore()
    const { entry, duplicate } = appendIngressRule(store, 'astrale', {
      hostname: 'a.example.com',
      service: 'http://localhost:8811',
    })
    expect(duplicate).toBe(false)
    expect(entry.ingress).toHaveLength(1)
    expect(entry.ingress[0]?.hostname).toBe('a.example.com')
  })

  test('detects exact (hostname, service, path) duplicates', () => {
    const store = makeStore()
    const rule = { hostname: 'a.example.com', service: 'http://localhost:8811' }
    appendIngressRule(store, 'astrale', rule)
    const second = appendIngressRule(store, 'astrale', rule)
    expect(second.duplicate).toBe(true)
    expect(second.entry.ingress).toHaveLength(1)
  })

  test('same (hostname, service) but different path → not a duplicate', () => {
    const store = makeStore()
    appendIngressRule(store, 'astrale', {
      hostname: 'a.example.com',
      service: 'http://localhost:8811',
      path: '/api/.*',
    })
    const second = appendIngressRule(store, 'astrale', {
      hostname: 'a.example.com',
      service: 'http://localhost:8811',
      path: '/admin/.*',
    })
    expect(second.duplicate).toBe(false)
    expect(second.entry.ingress).toHaveLength(2)
  })

  test('throws TunnelNotFoundError on unknown name', () => {
    const store = makeStore()
    expect(() =>
      appendIngressRule(store, 'nope', {
        hostname: 'h',
        service: 'http://localhost:1',
      }),
    ).toThrow(TunnelNotFoundError)
  })

  test('resolves by id as well as name', () => {
    const store = makeStore()
    const { entry } = appendIngressRule(store, 'abc-123', {
      hostname: 'h',
      service: 'http://localhost:1',
    })
    expect(entry.name).toBe('astrale')
  })
})

describe('IngressRuleSchema.path — non-empty when present (#6)', () => {
  test('rejects an empty path', () => {
    expect(() =>
      IngressRuleSchema.parse({ hostname: 'h', service: 'http://localhost:1', path: '' }),
    ).toThrow()
  })

  test('accepts a non-empty path and an omitted path', () => {
    expect(
      IngressRuleSchema.parse({ hostname: 'h', service: 'http://localhost:1', path: '/api/.*' })
        .path,
    ).toBe('/api/.*')
    expect(
      IngressRuleSchema.parse({ hostname: 'h', service: 'http://localhost:1' }).path,
    ).toBeUndefined()
  })
})

describe('writeTunnels — validate-on-write invariant (#1)', () => {
  test('refuses to persist a non-http(s) service (throws before any write)', async () => {
    await expect(
      writeTunnels({
        tunnels: {
          a: {
            id: 'i',
            name: 'a',
            adapter: 'cloudflared',
            hostname: 'h',
            createdAt: 't',
            ingress: [{ hostname: 'h', service: 'tcp://localhost:22' }],
          },
        },
      }),
    ).rejects.toThrow()
  })
})

describe('detachInstanceTunnels — best-effort (#2)', () => {
  test('swallows a throwing reader and reports the error (never blocks deletion)', async () => {
    const res = await detachInstanceTunnels('inst', async () => {
      throw new Error('corrupt registry')
    })
    expect(res.detached).toEqual([])
    expect(res.error).toContain('corrupt registry')
  })

  test('detaches only tunnels bound to the instance', async () => {
    const store = makeStore()
    store.tunnels.astrale!.boundInstance = 'inst'
    store.tunnels.secondary!.boundInstance = 'other'
    const unbound: string[] = []
    const res = await detachInstanceTunnels(
      'inst',
      async () => store,
      async (n) => {
        unbound.push(n)
      },
    )
    expect(res.error).toBeUndefined()
    expect(res.detached).toEqual(['astrale'])
    expect(unbound).toEqual(['astrale'])
  })
})
