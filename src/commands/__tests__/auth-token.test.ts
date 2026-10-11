import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { tokenEndpoint, writeIdp } from '../../lib/__tests__/idp.fixture'
import { runCli } from './fixtures/process'

let tmp: string
const runAuthToken = (...args: string[]) => runCli(tmp, ['auth', 'token', ...args])

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'astrale-auth-token-'))
  await mkdir(join(tmp, 'idp-sessions'), { recursive: true })
  await writeFile(
    join(tmp, 'identities.json'),
    JSON.stringify({
      version: 1,
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
    }),
  )
  await writeFile(
    join(tmp, 'idp-sessions', 'alice.json'),
    JSON.stringify({
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
    }),
  )
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('auth token command', () => {
  test('prints the active IdP access token, or a selected token as JSON', async () => {
    expect(await runAuthToken('--raw')).toEqual({
      exitCode: 0,
      stdout: 'access-token-123\n',
      stderr: '',
    })
    const result = await runAuthToken('--idp', 'workos', '--type', 'id', '--json')
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      identity: 'alice',
      type: 'id',
      token: 'id-token-123',
    })
  })

  test('an expired token is refreshed unless --no-refresh, and an IdP outage asks no re-login', async () => {
    const server = tokenEndpoint()
    try {
      await writeExpiredSessionWithIdp(server.url)

      const cached = await runAuthToken('--raw', '--no-refresh')
      expect(cached.stdout).toBe('expired-access-token\n')
      expect(server.refreshCount()).toBe(0)

      server.answer(() => Response.json({ error_description: 'unavailable' }, { status: 503 }))
      const outage = await runAuthToken('--raw')
      expect(outage.exitCode).toBe(1)
      expect(outage.stderr).not.toContain('astrale auth login')

      server.answer(undefined)
      expect(await runAuthToken('--raw')).toMatchObject({
        exitCode: 0,
        stdout: 'rotated-access-1\n',
      })
    } finally {
      await server.stop()
    }
  })
})

describe('IdP configurations and sessions', () => {
  test('a login persists the built-in WorkOS IdP, listed once beside configured IdPs', async () => {
    const login = await runCli(tmp, [
      'auth',
      'login',
      '--idp',
      'workos',
      '--client-credentials',
      '--client-secret-env',
      'UNSET_TEST_SECRET',
      '--raw',
    ])
    expect(login.stderr).toContain('Client secret env var UNSET_TEST_SECRET is not set')
    const index = JSON.parse(await readFile(join(tmp, 'idps', 'index.json'), 'utf8'))
    expect(index.idps.workos).toMatchObject({ builtIn: true })
    const listed = async () =>
      JSON.parse((await runCli(tmp, ['idp', 'list', '--json'])).stdout).map(
        ({ name }: { name: string }) => name,
      )
    expect(await listed()).toEqual(['workos'])
    await writeIdp(tmp, 'https://idp.test')
    expect(await listed()).toEqual(['test', 'workos'])

    const unknown = await runCli(tmp, ['auth', 'login', '--idp', 'nowhere', '--raw'])
    expect(unknown.exitCode).not.toBe(0)
    expect(unknown.stderr).toContain('IdP "nowhere" not found')
    const status = await runCli(tmp, ['auth', 'status', '--json'])
    expect(JSON.parse(status.stdout)).toEqual([
      expect.objectContaining({
        name: 'alice',
        session: expect.objectContaining({ cached: true }),
      }),
    ])
  })
})

async function writeExpiredSessionWithIdp(issuer: string): Promise<void> {
  await writeIdp(tmp, issuer)
  await writeFile(
    join(tmp, 'idp-sessions', 'alice.json'),
    JSON.stringify({
      identity: 'alice',
      idp: 'test',
      issuer,
      subject: 'user_123',
      access_token: 'expired-access-token',
      refresh_token: 'rt-0',
      token_type: 'Bearer',
      expires_at: new Date(Date.now() - 3_600_000).toISOString(),
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  )
}
