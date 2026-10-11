import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { tokenEndpoint, unsignedJwt, writeIdp } from './idp.fixture'

const AUD = 'https://kernel.example.com'

let tmp: string
let server: ReturnType<typeof rotation>

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'astrale-idp-session-'))
  await mkdir(join(tmp, 'idp-sessions'), { recursive: true })
  server = rotation()
  await writeIdp(tmp, server.url)
})

afterEach(async () => {
  await server.stop()
  await rm(tmp, { recursive: true, force: true })
})

describe('ensureFreshSession', () => {
  test('refreshes a cached audience token when its explicit owner organization changed', async () => {
    const stale = unsignedJwt({ aud: AUD, exp: futureEpoch(), org_id: 'old-organization' })
    await writeSession({
      access_token: stale,
      expires_at: future(),
      tokens: {
        [AUD]: { access_token: stale, expires_at: future() },
      },
    })
    const options = {
      DRIVER_AUDIENCE: AUD,
      DRIVER_EXPECTED_ORG: 'new-organization',
    }
    const [result, concurrent] = await Promise.all([
      runDriver('ensure', options),
      runDriver('ensure', options),
    ])
    expect(result.ok).toBe(true)
    expect(concurrent.ok).toBe(true)
    expect(concurrent.token).toBe(result.token)
    expect((await runDriver('ensure', options)).token).toBe(result.token)
    // Concurrent processes serialize on the lock: one refresh, the single-use token survives.
    expect(server.refreshCount()).toBe(1)
    expect(await lockFilesLeft()).toEqual([])
    expect(server.forms.at(-1)?.get('organization_id')).toBe('new-organization')
    expect(result.token).not.toBe(stale)
  })
  test('serves a fresh per-audience token without a refresh or an org hint', async () => {
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
  })

  test('refreshes an expired session, rotating the refresh token and caching by audience', async () => {
    await writeSession({ clientId: 'c_session', expires_at: past() })

    const result = await runDriver('ensure', { DRIVER_AUDIENCE: AUD, DRIVER_ORG_ID: 'org_1' })

    expect(result.ok).toBe(true)
    expect(result.orgHintCalls).toBe(1)
    expect(server.refreshCount()).toBe(1)
    const session = await readSession()
    // The client that issued the session refreshes it, not the IdP default.
    expect(session.clientId).toBe('c_session')
    expect(session.refresh_token).toBe('rt-1')
    expect((session.tokens as Record<string, { access_token: string }>)[AUD].access_token).toBe(
      result.token as string,
    )
    expect(server.forms.at(-1)?.get('organization_id')).toBe('org_1')
    expect(server.forms.at(-1)?.get('client_id')).toBe('c_session')
  })

  test('refreshes at the conservative whole-second lifetime boundary', async () => {
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
  })

  test.each([
    [undefined, true],
    ['other-org', false],
  ] as const)(
    'rescues a rotated session only when explicit organization %s matches (accepted: %s)',
    async (organizationId, accepted) => {
      const winnerToken = unsignedJwt({ aud: AUD, exp: futureEpoch(), org_id: 'winner-org' })
      server.answer(async () => {
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
      })
      await writeSession({ expires_at: past() })

      const result = await runDriver(
        'ensure',
        organizationId ? { DRIVER_EXPECTED_ORG: organizationId } : {},
      )

      expect(result.ok).toBe(accepted)
      if (accepted) expect(result.token).toBe(winnerToken)
      else expect(result.token).toBeUndefined()
    },
  )

  test('reports a missing session when it is deleted while waiting for the lock', async () => {
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
  })

  test.each([
    ['a dead grant no winner can rescue', 'session-ended', true],
    ['an unreachable IdP', 'transient', false],
  ] as const)('classifies %s as %s', async (_name, classification, reachable) => {
    if (!reachable) await server.stop()
    await writeSession({ expires_at: past(), refresh_token: 'rt-already-burned' })
    expect(await runDriver('ensure')).toMatchObject({ ok: false, classification })
  })
})

// --- fixtures -------------------------------------------------------------

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

/** The test IdP's token endpoint, minting audience tokens that carry the requested organization. */
const rotation = () =>
  tokenEndpoint({
    mint: (form) => {
      const organization = form.get('organization_id')
      return unsignedJwt({
        aud: AUD,
        exp: futureEpoch(),
        ...(organization === null ? {} : { org_id: organization }),
      })
    },
  })

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

function future(): string {
  return new Date(Date.now() + 3_600_000).toISOString()
}

function futureEpoch(): number {
  return Math.floor(Date.now() / 1000) + 3600
}

function past(): string {
  return new Date(Date.now() - 3_600_000).toISOString()
}
