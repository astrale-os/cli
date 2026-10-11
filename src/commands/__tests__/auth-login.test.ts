import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { tokenEndpoint, unsignedJwt, writeIdp } from '../../lib/__tests__/idp.fixture'
import { runCli } from './fixtures/process'

let tmp: string
const runAuthLogin = (...args: string[]) =>
  runCli(tmp, ['auth', 'login', ...args], { env: { TEST_CLIENT_SECRET: 'secret_123' } })

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'astrale-auth-login-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const CLIENT = { client_id: 'client_123', client_secret_env: 'TEST_CLIENT_SECRET' }
const LOGIN = [
  '--idp',
  'test',
  '--name',
  'alice',
  '--client-credentials',
  '--client-secret-env',
  'TEST_CLIENT_SECRET',
  '--raw',
]
const token = (claims: Record<string, unknown> = {}) =>
  unsignedJwt({ iss: 'http://127.0.0.1', sub: 'user_123', exp: 1893456000, ...claims })
const session = async () =>
  JSON.parse(await readFile(join(tmp, 'idp-sessions', 'alice.json'), 'utf8').catch(() => 'null'))

describe('auth login command', () => {
  test('refuses unversioned identity state before OAuth, then recovers explicitly without losing keys', async () => {
    const accessToken = token()
    const server = tokenEndpoint({ mint: () => accessToken })
    const path = join(tmp, 'identities.json')
    const saved = `${JSON.stringify({ default: 'manager', identities: {} })}\n`
    const privatePath = join(tmp, 'keys', 'manager.private.jwk')
    try {
      await writeIdp(tmp, server.url, CLIENT)
      await writeFile(path, saved)
      await mkdir(join(tmp, 'keys'))
      await writeFile(privatePath, 'retained private key bytes')

      const refused = await runAuthLogin(...LOGIN)
      expect(refused.exitCode).toBe(1)
      expect(refused.stderr).toContain('Rename this file to preserve it')
      expect(server.forms.map((form) => form.get('client_id'))).toEqual([])
      expect(await session()).toBeNull()

      await rename(path, `${path}.saved`)
      expect((await runAuthLogin(...LOGIN)).exitCode).toBe(0)
      expect(await readFile(privatePath, 'utf8')).toBe('retained private key bytes')
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
        version: 1,
        default: 'alice',
      })
      expect((await session()).access_token).toBe(accessToken)
    } finally {
      await server.stop()
    }
  })

  test('stores the session only when the provider mints the requested audience', async () => {
    const audience = ['--audience', 'https://kernel.example.com']
    let minted = token({ aud: 'unknown/api' })
    const server = tokenEndpoint({ mint: () => minted })
    try {
      await writeIdp(tmp, server.url, CLIENT)
      const refused = await runAuthLogin(...LOGIN, ...audience)
      expect(refused.exitCode).toBe(1)
      expect(refused.stderr).toContain(
        'IdP response access_token was not minted for requested audience https://kernel.example.com',
      )
      expect(await session()).toBeNull()

      minted = token({ aud: 'https://kernel.example.com' })
      expect((await runAuthLogin(...LOGIN, ...audience)).exitCode).toBe(0)
      expect(await session()).toMatchObject({
        audience: 'https://kernel.example.com',
        clientId: 'client_123',
        // The token's own claims name the session, not the IdP configuration.
        issuer: 'http://127.0.0.1',
        subject: 'user_123',
      })
    } finally {
      await server.stop()
    }
  })

  test('persists an explicit client id and reuses it for a named login', async () => {
    const server = tokenEndpoint({ mint: () => token() })
    try {
      await writeIdp(tmp, server.url, CLIENT)
      expect((await runAuthLogin(...LOGIN, '--client-id', 'client_override')).exitCode).toBe(0)
      expect((await runAuthLogin(...LOGIN)).exitCode).toBe(0)
      expect(server.forms.map((form) => form.get('client_id'))).toEqual([
        'client_override',
        'client_override',
      ])
      expect(Object.fromEntries(server.forms[0]!)).toMatchObject({
        grant_type: 'client_credentials',
        client_secret: 'secret_123',
        scope: 'openid profile email offline_access',
      })
      expect((await session()).clientId).toBe('client_override')
    } finally {
      await server.stop()
    }
  })
})
