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
})

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
