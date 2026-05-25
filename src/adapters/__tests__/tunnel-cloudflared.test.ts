import { describe, expect, test } from 'bun:test'

import { TunnelUnsupportedConfigError } from '../../errors'
import { buildRunArgs, firstConcreteHostname, parseCloudflaredIngress } from '../tunnel-cloudflared'

describe('buildRunArgs — cloudflared spawn args', () => {
  const id = 'b4a87968-b092-46c3-9297-6eb0c3483cfd'

  test('renders `tunnel --config <path> run <id>`', () => {
    expect(buildRunArgs(id, '/home/u/.astrale/tunnels/x.yml')).toEqual([
      'tunnel',
      '--config',
      '/home/u/.astrale/tunnels/x.yml',
      'run',
      id,
    ])
  })

  test('cmdline matches the isCloudflaredRunningFor pgrep pattern `tunnel.*run <id>`', () => {
    const cmdline = `cloudflared ${buildRunArgs(id, '/p/x.yml').join(' ')}`
    expect(new RegExp(`cloudflared tunnel.*run ${id}`).test(cmdline)).toBe(true)
  })
})

describe('parseCloudflaredIngress — http(s)-only import, refuses the rest', () => {
  test('extracts hostname+service rules in declared order', () => {
    const yaml = `
ingress:
  - hostname: a.example.com
    service: http://localhost:4400
  - hostname: b.example.com
    service: http://localhost:8787
  - service: http_status:404
`
    expect(parseCloudflaredIngress('t', yaml)).toEqual([
      { hostname: 'a.example.com', service: 'http://localhost:4400' },
      { hostname: 'b.example.com', service: 'http://localhost:8787' },
    ])
  })

  test('preserves wildcard hostnames and path (#3)', () => {
    const yaml = `
ingress:
  - hostname: "*.fn.dist.example.ai"
    service: http://localhost:8787
    path: /api/.*
  - hostname: dist.example.ai
    service: http://localhost:8787
`
    expect(parseCloudflaredIngress('t', yaml)).toEqual([
      { hostname: '*.fn.dist.example.ai', service: 'http://localhost:8787', path: '/api/.*' },
      { hostname: 'dist.example.ai', service: 'http://localhost:8787' },
    ])
  })

  test('skips catch-all entries without a hostname', () => {
    const yaml = `
ingress:
  - hostname: a.example.com
    service: http://localhost:9000
  - service: http_status:404
`
    expect(parseCloudflaredIngress('t', yaml)).toEqual([
      { hostname: 'a.example.com', service: 'http://localhost:9000' },
    ])
  })

  test('REFUSES non-http(s) services (#1)', () => {
    const yaml = `
ingress:
  - hostname: ssh.example.com
    service: ssh://localhost:22
  - service: http_status:404
`
    expect(() => parseCloudflaredIngress('my-tunnel', yaml)).toThrow(TunnelUnsupportedConfigError)
  })

  test('REFUSES rules carrying originRequest options (#4)', () => {
    const yaml = `
ingress:
  - hostname: api.example.com
    service: https://localhost:8443
    originRequest:
      noTLSVerify: true
  - service: http_status:404
`
    expect(() => parseCloudflaredIngress('my-tunnel', yaml)).toThrow(TunnelUnsupportedConfigError)
  })

  test('REFUSES a top-level originRequest block (#4 global)', () => {
    const yaml = `
originRequest:
  noTLSVerify: true
ingress:
  - hostname: api.example.com
    service: https://localhost:8443
  - service: http_status:404
`
    expect(() => parseCloudflaredIngress('my-tunnel', yaml)).toThrow(TunnelUnsupportedConfigError)
  })

  test('REFUSES when warp-routing is enabled', () => {
    const yaml = `
warp-routing:
  enabled: true
ingress:
  - hostname: api.example.com
    service: http://localhost:8443
  - service: http_status:404
`
    expect(() => parseCloudflaredIngress('my-tunnel', yaml)).toThrow(TunnelUnsupportedConfigError)
  })

  test('returns [] when no ingress block is present', () => {
    expect(parseCloudflaredIngress('t', 'tunnel: foo\n')).toEqual([])
  })
})

describe('firstConcreteHostname — wildcard-safe inference (#5)', () => {
  test('skips wildcards and picks the first concrete hostname', () => {
    expect(
      firstConcreteHostname([
        { hostname: '*.fn.dist.example.ai', service: 'http://localhost:8787' },
        { hostname: 'dist.example.ai', service: 'http://localhost:8787' },
      ]),
    ).toBe('dist.example.ai')
  })

  test('returns undefined when every hostname is a wildcard', () => {
    expect(
      firstConcreteHostname([{ hostname: '*.a.example.ai', service: 'http://localhost:1' }]),
    ).toBeUndefined()
  })
})
