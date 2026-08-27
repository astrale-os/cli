import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const AUD = 'https://kernel.example.com'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'astrale-idp-session-'))
  await mkdir(join(tmp, 'idp-sessions'), { recursive: true })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('ensureFreshSession', () => {
  test('returns a fresh session without touching the IdP or the org hint', async () => {
    const server = rotationServer()
    try {
      await writeIdpConfig(server.url)
      await writeSession({ expires_at: future() })

      const result = await runDriver('ensure')

      expect(result.ok).toBe(true)
      expect(result.orgHintCalls).toBe(0)
      expect(server.refreshCount()).toBe(0)
    } finally {
      await server.stop()
    }
  })

  test('serves an instance flip from the per-audience map without a refresh', async () => {
    const server = rotationServer()
    try {
      await writeIdpConfig(server.url)
      await writeSession({
        access_token: unsignedJwt({ aud: 'https://other.example.com', exp: futureEpoch() }),
        expires_at: future(),
        tokens: {
          [AUD]: { access_token: 'cached-for-kernel', expires_at: future() },
        },
      })

      const result = await runDriver('ensure', { DRIVER_AUDIENCE: AUD })

      expect(result.ok).toBe(true)
      expect(result.token).toBe('cached-for-kernel')
      expect(result.orgHintCalls).toBe(0)
      expect(server.refreshCount()).toBe(0)
    } finally {
      await server.stop()
    }
  })

  test('refreshes an expired session, rotating the refresh token and caching by audience', async () => {
    const server = rotationServer()
    try {
      await writeIdpConfig(server.url)
      await writeSession({ expires_at: past() })

      const result = await runDriver('ensure', { DRIVER_AUDIENCE: AUD, DRIVER_ORG_ID: 'org_1' })

      expect(result.ok).toBe(true)
      expect(result.orgHintCalls).toBe(1)
      expect(server.refreshCount()).toBe(1)
      const session = await readSession()
      expect(session.clientId).toBe('c_1')
      expect(session.refresh_token).toBe('rt-1')
      expect((session.tokens as Record<string, { access_token: string }>)[AUD].access_token).toBe(
        result.token as string,
      )
      expect(server.lastOrganizationId()).toBe('org_1')
      expect(server.lastClientId()).toBe('c_1')
    } finally {
      await server.stop()
    }
  })

  test('refreshes at the conservative whole-second lifetime boundary', async () => {
    const server = rotationServer()
    try {
      await writeIdpConfig(server.url)
      const shortToken = unsignedJwt({ aud: AUD, exp: Math.ceil(Date.now() / 1_000) + 200 })
      await writeSession({
        access_token: shortToken,
        // The loose millisecond timestamp appears sufficient. Delegation uses
        // the JWT exp and its conservative second-boundary handoff instead.
        expires_at: new Date(Date.now() + 201_000).toISOString(),
      })

      const result = await runDriver('ensure', {
        DRIVER_AUDIENCE: AUD,
        DRIVER_MINIMUM_SECONDS: '200',
      })

      expect(result.ok).toBe(true)
      expect(server.refreshCount()).toBe(1)
      expect(result.token).not.toBe(shortToken)
    } finally {
      await server.stop()
    }
  })

  test('refreshes with the client that issued the session instead of the IdP default', async () => {
    const server = rotationServer()
    try {
      await writeIdpConfig(server.url)
      await writeSession({ clientId: 'c_session', expires_at: past() })

      const result = await runDriver('ensure', { DRIVER_AUDIENCE: AUD })

      expect(result.ok).toBe(true)
      expect(server.lastClientId()).toBe('c_session')
      expect((await readSession()).clientId).toBe('c_session')
    } finally {
      await server.stop()
    }
  })

  test('two concurrent callers in one process perform exactly one refresh', async () => {
    const server = rotationServer({ delayMs: 50 })
    try {
      await writeIdpConfig(server.url)
      await writeSession({ expires_at: past() })

      const result = await runDriver('ensure-concurrent')

      expect(result.ok).toBe(true)
      const [a, b] = result.tokens as [string, string]
      expect(a).toBe(b)
      expect(server.refreshCount()).toBe(1)
    } finally {
      await server.stop()
    }
  })

  test('two concurrent PROCESSES perform exactly one refresh (single-use token survives)', async () => {
    const server = rotationServer({ delayMs: 50 })
    try {
      await writeIdpConfig(server.url)
      await writeSession({ expires_at: past() })

      const [a, b] = await Promise.all([runDriver('ensure'), runDriver('ensure')])

      expect(a.ok).toBe(true)
      expect(b.ok).toBe(true)
      expect(a.token).toBe(b.token)
      expect(server.refreshCount()).toBe(1)
      expect(await lockFilesLeft()).toEqual([])
    } finally {
      await server.stop()
    }
  })

  test('rescues an invalid_grant raced by a non-locking winner that saved a rotated session', async () => {
    const winnerToken = unsignedJwt({ aud: AUD, exp: futureEpoch() })
    const server = rotationServer({
      beforeRespond: async () => {
        // Simulate an old, non-locking CLI that already exchanged the token
        // and persisted the rotated session before our request landed.
        await writeSession({
          access_token: winnerToken,
          expires_at: future(),
          refresh_token: 'rt-winner',
          updatedAt: new Date(Date.now() + 1000).toISOString(),
        })
        return Response.json(
          { error: 'invalid_grant', error_description: 'Refresh token already exchanged.' },
          { status: 400 },
        )
      },
    })
    try {
      await writeIdpConfig(server.url)
      await writeSession({ expires_at: past() })

      const result = await runDriver('ensure')

      expect(result.ok).toBe(true)
      expect(result.token).toBe(winnerToken)
    } finally {
      await server.stop()
    }
  })

  test('reports a missing session when it is deleted while waiting for the lock', async () => {
    const server = rotationServer()
    try {
      await writeIdpConfig(server.url)
      await writeSession({ expires_at: past() })
      const lockPath = join(tmp, 'idp-sessions', 'alice.json.lock')
      await writeFile(lockPath, JSON.stringify({ pid: process.pid }))

      const pending = runDriver('ensure')
      await new Promise((r) => setTimeout(r, 300))
      await unlink(join(tmp, 'idp-sessions', 'alice.json'))
      await unlink(lockPath)
      const result = await pending

      expect(result.ok).toBe(false)
      expect(result.errorName).toBe('IdpSessionMissingError')
      expect(await lockFilesLeft()).toEqual([])
    } finally {
      await server.stop()
    }
  })

  test('classifies a dead grant as session-ended when no winner can rescue it', async () => {
    const server = rotationServer()
    try {
      await writeIdpConfig(server.url)
      await writeSession({ expires_at: past(), refresh_token: 'rt-already-burned' })

      const result = await runDriver('ensure')

      expect(result.ok).toBe(false)
      expect(result.errorName).toBe('OAuthTokenError')
      expect(result.errorCode).toBe('invalid_grant')
      expect(result.classification).toBe('session-ended')
    } finally {
      await server.stop()
    }
  })

  test('classifies an IdP 503 as transient', async () => {
    const server = rotationServer({
      beforeRespond: async () =>
        Response.json({ error_description: 'upstream unavailable' }, { status: 503 }),
    })
    try {
      await writeIdpConfig(server.url)
      await writeSession({ expires_at: past() })

      const result = await runDriver('ensure')

      expect(result.ok).toBe(false)
      expect(result.classification).toBe('transient')
    } finally {
      await server.stop()
    }
  })

  test('classifies an unreachable IdP as transient', async () => {
    const server = rotationServer()
    await server.stop()
    await writeIdpConfig(server.url)
    await writeSession({ expires_at: past() })

    const result = await runDriver('ensure')

    expect(result.ok).toBe(false)
    expect(result.classification).toBe('transient')
  })
})

// --- fixtures -------------------------------------------------------------

async function writeIdpConfig(baseUrl: string): Promise<void> {
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
}

async function writeSession(overrides: Record<string, unknown>): Promise<void> {
  await writeFile(
    join(tmp, 'idp-sessions', 'alice.json'),
    JSON.stringify({
      identity: 'alice',
      idp: 'test',
      issuer: 'https://idp.example.com',
      subject: 'user_123',
      access_token: 'expired-access-token',
      refresh_token: 'rt-0',
      token_type: 'Bearer',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }),
  )
}

async function readSession(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(tmp, 'idp-sessions', 'alice.json'), 'utf-8'))
}

async function lockFilesLeft(): Promise<string[]> {
  const entries = await readdir(join(tmp, 'idp-sessions'))
  return entries.filter((e) => e.endsWith('.lock') || e.endsWith('.tmp'))
}

function rotationServer(opts?: {
  delayMs?: number
  beforeRespond?: () => Promise<Response | undefined>
}): {
  url: string
  refreshCount: () => number
  lastClientId: () => string | undefined
  lastOrganizationId: () => string | undefined
  stop: () => Promise<void>
} {
  // WorkOS-style single-use rotation: presenting anything but the CURRENT
  // refresh token is invalid_grant.
  let current = 'rt-0'
  let count = 0
  let lastClientId: string | undefined
  let lastOrgId: string | undefined
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname !== '/token') return new Response('not found', { status: 404 })
      const form = new URLSearchParams(await request.text())
      if (opts?.beforeRespond) {
        const response = await opts.beforeRespond()
        if (response) return response
      }
      if (form.get('refresh_token') !== current) {
        return Response.json(
          { error: 'invalid_grant', error_description: 'Refresh token already exchanged.' },
          { status: 400 },
        )
      }
      if (opts?.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      count += 1
      current = `rt-${count}`
      lastClientId = form.get('client_id') ?? undefined
      lastOrgId = form.get('organization_id') ?? undefined
      return Response.json({
        access_token: unsignedJwt({ aud: AUD, exp: futureEpoch() }),
        refresh_token: current,
        token_type: 'Bearer',
        expires_in: 3600,
      })
    },
  })
  return {
    url: `http://${server.hostname}:${server.port}`,
    refreshCount: () => count,
    lastClientId: () => lastClientId,
    lastOrganizationId: () => lastOrgId,
    stop: () => server.stop(true),
  }
}

async function runDriver(
  scenario: string,
  env: Record<string, string> = {},
): Promise<Record<string, unknown> & { tokens?: unknown }> {
  const proc = Bun.spawn({
    cmd: ['bun', join(import.meta.dir, 'idp-session.driver.ts'), scenario],
    env: { ...process.env, ASTRALE_HOME: tmp, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) throw new Error(`driver exited ${exitCode}: ${stderr}`)
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}')
}

function unsignedJwt(payload: Record<string, unknown>): string {
  return [base64url({ alg: 'none', typ: 'JWT' }), base64url(payload), ''].join('.')
}

function base64url(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function future(): string {
  return new Date(Date.now() + 3_600_000).toISOString()
}

function futureEpoch(): number {
  return Math.floor(Date.now() / 1000) + 3600
}

function past(): string {
  return new Date(Date.now() - 3_600_000).toISOString()
}
