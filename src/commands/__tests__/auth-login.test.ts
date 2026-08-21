import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cliRoot = join(import.meta.dir, '../../..')

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'astrale-auth-login-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('auth login command', () => {
  test('rejects requested audience when provider mints a different access-token aud', async () => {
    const server = oauthServer({
      accessToken: unsignedJwt({
        iss: 'http://127.0.0.1',
        sub: 'user_123',
        aud: 'unknown/api',
        exp: 1893456000,
      }),
    })
    try {
      await writeIdpConfig(server.url)

      const result = await runAuthLogin(
        '--idp',
        'test',
        '--name',
        'alice',
        '--client-credentials',
        '--client-secret-env',
        'TEST_CLIENT_SECRET',
        '--audience',
        'https://kernel.example.com',
        '--raw',
      )

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain(
        'IdP response access_token was not minted for requested audience https://kernel.example.com',
      )
      expect(
        await readFile(join(tmp, 'idp-sessions', 'alice.json'), 'utf-8').catch(() => null),
      ).toBeNull()
    } finally {
      await server.stop()
    }
  })

  test('stores the session when provider mints the requested access-token aud', async () => {
    const server = oauthServer({
      accessToken: unsignedJwt({
        iss: 'http://127.0.0.1',
        sub: 'user_123',
        aud: 'https://kernel.example.com',
        exp: 1893456000,
      }),
    })
    try {
      await writeIdpConfig(server.url)

      const result = await runAuthLogin(
        '--idp',
        'test',
        '--name',
        'alice',
        '--client-credentials',
        '--client-secret-env',
        'TEST_CLIENT_SECRET',
        '--audience',
        'https://kernel.example.com',
        '--raw',
      )

      expect(result.exitCode).toBe(0)
      const session = JSON.parse(await readFile(join(tmp, 'idp-sessions', 'alice.json'), 'utf-8'))
      expect(session.audience).toBe('https://kernel.example.com')
      expect(session.clientId).toBe('client_123')
      expect(session.subject).toBe('user_123')
    } finally {
      await server.stop()
    }
  })

  test('persists an explicit client id and reuses it for a named login', async () => {
    const server = oauthServer({
      accessToken: unsignedJwt({
        iss: 'http://127.0.0.1',
        sub: 'user_123',
        exp: 1893456000,
      }),
    })
    try {
      await writeIdpConfig(server.url)

      const explicit = await runAuthLogin(
        '--idp',
        'test',
        '--name',
        'alice',
        '--client-id',
        'client_override',
        '--client-credentials',
        '--client-secret-env',
        'TEST_CLIENT_SECRET',
        '--raw',
      )
      const reused = await runAuthLogin(
        '--idp',
        'test',
        '--name',
        'alice',
        '--client-credentials',
        '--client-secret-env',
        'TEST_CLIENT_SECRET',
        '--raw',
      )

      expect(explicit.exitCode).toBe(0)
      expect(reused.exitCode).toBe(0)
      expect(server.clientIds()).toEqual(['client_override', 'client_override'])
      const session = JSON.parse(await readFile(join(tmp, 'idp-sessions', 'alice.json'), 'utf-8'))
      expect(session.clientId).toBe('client_override')
    } finally {
      await server.stop()
    }
  })
})

async function writeIdpConfig(baseUrl: string): Promise<void> {
  await mkdir(join(tmp, 'idps', 'test'), { recursive: true })
  await writeFile(
    join(tmp, 'idps', 'index.json'),
    JSON.stringify(
      {
        idps: {
          test: {
            issuer: baseUrl,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
      null,
      2,
    ) + '\n',
  )
  await writeFile(
    join(tmp, 'idps', 'test', 'metadata.json'),
    JSON.stringify(
      {
        issuer: baseUrl,
        token_endpoint: `${baseUrl}/token`,
        jwks_uri: `${baseUrl}/jwks`,
      },
      null,
      2,
    ) + '\n',
  )
  await writeFile(
    join(tmp, 'idps', 'test', 'client.json'),
    JSON.stringify(
      {
        client_id: 'client_123',
        client_secret_env: 'TEST_CLIENT_SECRET',
      },
      null,
      2,
    ) + '\n',
  )
}

function oauthServer(args: { accessToken: string }): {
  url: string
  clientIds: () => Array<string | null>
  stop: () => Promise<void>
} {
  const clientIds: Array<string | null> = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname !== '/token') return new Response('not found', { status: 404 })
      const form = new URLSearchParams(await request.text())
      clientIds.push(form.get('client_id'))
      return Response.json({
        access_token: args.accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
      })
    },
  })
  return {
    url: `http://${server.hostname}:${server.port}`,
    clientIds: () => clientIds,
    stop: () => server.stop(true),
  }
}

async function runAuthLogin(...args: string[]): Promise<{
  exitCode: number
  stdout: string
  stderr: string
}> {
  const proc = Bun.spawn({
    cmd: ['bun', join(cliRoot, 'bin/astrale.ts'), 'auth', 'login', ...args],
    env: { ...process.env, ASTRALE_HOME: tmp, TEST_CLIENT_SECRET: 'secret_123' },
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

function unsignedJwt(payload: Record<string, unknown>): string {
  return [base64url({ alg: 'none', typ: 'JWT' }), base64url(payload), ''].join('.')
}

function base64url(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
