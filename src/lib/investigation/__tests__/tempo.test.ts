import { expect, test } from 'bun:test'

import { createTempoReader } from '../tempo'

test('real HTTP transport renews only an expired Cockpit session and repeats the same read', async () => {
  let logins = 0
  const requests: string[] = []
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      requests.push(path)
      if (path === '/login') {
        expect(request.headers.get('X-Auth-Token')).toBe('operator-key')
        return new Response(null, {
          status: 302,
          headers: { 'Set-Cookie': `session=${++logins}; HttpOnly`, Location: '/' },
        })
      }
      if (request.headers.get('Cookie') === 'session=1') return new Response(null, { status: 401 })
      return Response.json({ batches: [] })
    },
  })
  try {
    const reader = createTempoReader({
      cockpitUrl: server.url.toString(),
      datasource: 'tempo',
      scalewayKey: 'operator-key',
    })
    expect(await reader.trace('ab')).toEqual({ batches: [] })
    expect(logins).toBe(2)
    expect(requests[1]).toBe(requests[3])
  } finally {
    server.stop(true)
  }
})

test('does not renew or change authority for a forbidden read', async () => {
  let calls = 0
  const server = Bun.serve({
    port: 0,
    fetch() {
      calls++
      return new Response(null, { status: 403 })
    },
  })
  try {
    await expect(
      createTempoReader({ tempoUrl: server.url.toString(), token: 'read-token' }).trace('ab'),
    ).rejects.toThrow('403')
    expect(calls).toBe(1)
  } finally {
    server.stop(true)
  }
})

test('bounds saturated searches, deduplicates trace IDs and exposes unknown job coverage', async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ traces: Array.from({ length: 100 }, () => ({ traceID: 'ab' })) })
    },
  })
  try {
    const result = await createTempoReader({ tempoUrl: server.url.toString() }).search(
      'instance',
      'operation',
      '2026-09-21T00:00:00Z',
      '2026-09-21T01:00:00Z',
      3,
    )
    expect(result.traceIds).toHaveLength(1)
    expect(result.coverage).toMatchObject({ status: 'partial', requests: 3, sampling: 'unknown' })
    expect(result.coverage.reasons).toContain('search-request-limit')
    expect(result.coverage.reasons).toContain('search-coverage-unavailable')
  } finally {
    server.stop(true)
  }
})

for (const provider of ['tempo', 'cockpit'] as const) {
  test(`inspect --${provider}-url overrides the other configured provider over real HTTP`, async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname
        requests.push(path)
        if (path === '/login') {
          expect(request.headers.get('X-Auth-Token')).toBe('operator-key')
          return new Response(null, { status: 302, headers: { 'Set-Cookie': 'session=test' } })
        }
        return new Response(null, { status: 404 })
      },
    })
    try {
      const child = Bun.spawn(
        [
          process.execPath,
          new URL('../../../../bin/astrale.ts', import.meta.url).pathname,
          'inspect',
          '--telemetry-instance',
          'instance',
          '--trace',
          'ab',
          `--${provider}-url`,
          server.url.toString(),
          '--tempo-datasource',
          'tempo',
          '--json',
        ],
        {
          env: {
            ...process.env,
            ASTRALE_TEMPO_URL: 'http://unused-tempo.invalid',
            ASTRALE_COCKPIT_URL: 'http://unused-cockpit.invalid',
            ASTRALE_TELEMETRY_TOKEN: '',
            SCW_API_KEY: 'operator-key',
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(code).toBe(1)
      expect(stdout + stderr).toContain('TELEMETRY_READ_FAILED')
      expect(requests).toEqual(
        provider === 'cockpit'
          ? [
              '/login',
              '/api/datasources/proxy/uid/tempo/api/traces/000000000000000000000000000000ab',
            ]
          : ['/api/traces/000000000000000000000000000000ab'],
      )
    } finally {
      server.stop(true)
    }
  })
}
