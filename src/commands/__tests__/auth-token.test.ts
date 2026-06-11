import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cliRoot = join(import.meta.dir, '../../..')

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'astrale-auth-token-'))
  await mkdir(join(tmp, 'idp-sessions'), { recursive: true })
  await writeFile(
    join(tmp, 'identities.json'),
    JSON.stringify(
      {
        default: 'alice',
        identities: {
          alice: {
            subject: 'user_123',
            createdAt: '2026-01-01T00:00:00.000Z',
            source: 'idp',
            mode: 'remote',
            idp: 'workos',
            issuer: 'https://api.workos.com',
          },
        },
      },
      null,
      2,
    ) + '\n',
  )
  await writeFile(
    join(tmp, 'idp-sessions', 'alice.json'),
    JSON.stringify(
      {
        identity: 'alice',
        idp: 'workos',
        issuer: 'https://api.workos.com',
        subject: 'user_123',
        access_token: 'access-token-123',
        id_token: 'id-token-123',
        token_type: 'Bearer',
        scope: 'openid profile email',
        expires_at: '2999-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      null,
      2,
    ) + '\n',
  )
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('auth token command', () => {
  test('prints the active IdP access token with --raw', async () => {
    const result = await runAuthToken('--raw')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('access-token-123\n')
    expect(result.stderr).toBe('')
  })

  test('can select by IdP and print id token metadata as JSON', async () => {
    const result = await runAuthToken('--idp', 'workos', '--type', 'id', '--json')

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')

    const body = JSON.parse(result.stdout) as { identity: string; type: string; token: string }
    expect(body.identity).toBe('alice')
    expect(body.type).toBe('id')
    expect(body.token).toBe('id-token-123')
  })

  test('two parallel CLI processes refresh a single-use token exactly once', async () => {
    const server = rotationServer()
    try {
      await writeExpiredSessionWithIdp(server.url)

      const [a, b] = await Promise.all([runAuthToken('--raw'), runAuthToken('--raw')])

      expect(a.exitCode).toBe(0)
      expect(b.exitCode).toBe(0)
      expect(a.stdout).toBe(b.stdout)
      expect(server.refreshCount()).toBe(1)
    } finally {
      await server.stop()
    }
  })

  test('an IdP outage does not tell the user to re-login', async () => {
    const server = rotationServer({ status: 503 })
    try {
      await writeExpiredSessionWithIdp(server.url)

      const result = await runAuthToken('--raw')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).not.toContain('astrale auth login')
    } finally {
      await server.stop()
    }
  })

  test('--no-refresh prints the cached token without contacting the IdP', async () => {
    const server = rotationServer()
    try {
      await writeExpiredSessionWithIdp(server.url)

      const result = await runAuthToken('--raw', '--no-refresh')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('expired-access-token\n')
      expect(server.refreshCount()).toBe(0)
    } finally {
      await server.stop()
    }
  })
})

async function writeExpiredSessionWithIdp(baseUrl: string): Promise<void> {
  await mkdir(join(tmp, 'idps', 'test'), { recursive: true })
  await writeFile(
    join(tmp, 'idps', 'index.json'),
    JSON.stringify({
      idps: {
        test: {
          issuer: baseUrl,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }),
  )
  await writeFile(
    join(tmp, 'idps', 'test', 'metadata.json'),
    JSON.stringify({
      issuer: baseUrl,
      token_endpoint: `${baseUrl}/token`,
      jwks_uri: `${baseUrl}/jwks`,
    }),
  )
  await writeFile(join(tmp, 'idps', 'test', 'client.json'), JSON.stringify({ client_id: 'c_1' }))
  await writeFile(
    join(tmp, 'idp-sessions', 'alice.json'),
    JSON.stringify({
      identity: 'alice',
      idp: 'test',
      issuer: baseUrl,
      subject: 'user_123',
      access_token: 'expired-access-token',
      refresh_token: 'rt-0',
      token_type: 'Bearer',
      expires_at: new Date(Date.now() - 3_600_000).toISOString(),
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  )
}

function rotationServer(opts?: { status?: number }): {
  url: string
  refreshCount: () => number
  stop: () => Promise<void>
} {
  // WorkOS-style single-use rotation: presenting anything but the CURRENT
  // refresh token is invalid_grant.
  let current = 'rt-0'
  let count = 0
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname !== '/token') return new Response('not found', { status: 404 })
      if (opts?.status) {
        return Response.json({ error_description: 'unavailable' }, { status: opts.status })
      }
      const form = new URLSearchParams(await request.text())
      if (form.get('refresh_token') !== current) {
        return Response.json(
          { error: 'invalid_grant', error_description: 'Refresh token already exchanged.' },
          { status: 400 },
        )
      }
      await new Promise((r) => setTimeout(r, 50))
      count += 1
      current = `rt-${count}`
      return Response.json({
        access_token: `rotated-access-${count}`,
        refresh_token: current,
        token_type: 'Bearer',
        expires_in: 3600,
      })
    },
  })
  return {
    url: `http://${server.hostname}:${server.port}`,
    refreshCount: () => count,
    stop: () => server.stop(true),
  }
}

async function runAuthToken(...args: string[]): Promise<{
  exitCode: number
  stdout: string
  stderr: string
}> {
  const proc = Bun.spawn({
    cmd: ['bun', join(cliRoot, 'bin/astrale.ts'), 'auth', 'token', ...args],
    env: { ...process.env, ASTRALE_HOME: tmp },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}
