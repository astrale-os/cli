import { describe, expect, test } from 'bun:test'

import type { TunnelEntry } from '../tunnels'

import { renderTunnelConfig, tunnelConfigPath } from '../cloudflared-config'

function entry(overrides: Partial<TunnelEntry> = {}): TunnelEntry {
  return {
    id: 'b4a87968-b092-46c3-9297-6eb0c3483cfd',
    name: 'ai-gateway-dev',
    adapter: 'cloudflared',
    hostname: 'ai-gateway.local-aidev.astrale.ai',
    createdAt: '2026-05-20T00:00:00Z',
    ingress: [],
    ...overrides,
  }
}

describe('renderTunnelConfig', () => {
  test('renders tunnel + credentials-file + catch-all when ingress is empty', () => {
    const yaml = renderTunnelConfig(entry(), '/home/u/.cloudflared/abc.json')
    expect(yaml).toContain('tunnel: b4a87968-b092-46c3-9297-6eb0c3483cfd')
    expect(yaml).toContain('credentials-file: /home/u/.cloudflared/abc.json')
    expect(yaml).toContain('ingress:')
    expect(yaml.trim().endsWith('- service: http_status:404')).toBe(true)
  })

  test('omits credentials-file line when none provided (token-auth tunnels)', () => {
    const yaml = renderTunnelConfig(entry(), null)
    expect(yaml).not.toContain('credentials-file:')
    expect(yaml).toContain('tunnel: b4a87968-b092-46c3-9297-6eb0c3483cfd')
  })

  test('renders a single ingress rule followed by the catch-all', () => {
    const yaml = renderTunnelConfig(
      entry({
        ingress: [
          { hostname: 'ai-gateway.local-aidev.astrale.ai', service: 'http://localhost:8811' },
        ],
      }),
      '/c.json',
    )
    const lines = yaml.split('\n')
    expect(lines).toContain('  - hostname: ai-gateway.local-aidev.astrale.ai')
    expect(lines).toContain('    service: http://localhost:8811')
    expect(yaml.trim().endsWith('- service: http_status:404')).toBe(true)
  })

  test('renders multiple rules in declared order + wildcard support', () => {
    const yaml = renderTunnelConfig(
      entry({
        ingress: [
          { hostname: 'gw.local-x.astrale.ai', service: 'http://localhost:8811' },
          { hostname: '*.fn.dist.local-x.astrale.ai', service: 'http://localhost:8833' },
        ],
      }),
      '/c.json',
    )
    const gwIdx = yaml.indexOf('hostname: gw.local-x.astrale.ai')
    // yaml.stringify quotes hostnames starting with `*` — either form is fine.
    const wildIdx = yaml.search(/hostname: ['"]?\*\.fn\.dist\.local-x\.astrale\.ai['"]?/)
    expect(gwIdx).toBeGreaterThanOrEqual(0)
    expect(wildIdx).toBeGreaterThan(gwIdx)
  })

  test('emits optional `path` when present', () => {
    const yaml = renderTunnelConfig(
      entry({
        ingress: [{ hostname: 'h', service: 'http://localhost:9', path: '/api/.*' }],
      }),
      '/c.json',
    )
    expect(yaml).toContain('path: /api/.*')
  })

  test('always ends with the catch-all rule', () => {
    const yaml = renderTunnelConfig(entry({ ingress: [] }), '/c.json')
    const yaml2 = renderTunnelConfig(
      entry({ ingress: [{ hostname: 'h', service: 'http://x' }] }),
      '/c.json',
    )
    expect(yaml.trim().endsWith('- service: http_status:404')).toBe(true)
    expect(yaml2.trim().endsWith('- service: http_status:404')).toBe(true)
  })
})

describe('tunnelConfigPath', () => {
  test('renders under TUNNELS_DIR with .yml extension', () => {
    const p = tunnelConfigPath('abc-123')
    expect(p.endsWith('/abc-123.yml')).toBe(true)
    expect(p).toContain('/tunnels/')
  })
})
