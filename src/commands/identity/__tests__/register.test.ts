import { issuer, jwk, register } from '@astrale-os/sdk/auth'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { afterEach, expect, spyOn, test } from 'bun:test'
import { exportJWK, generateKeyPair, jwtVerify } from 'jose'
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { keypairPaths } from '../../../keys'
import { observeConnections, runCli } from '../../__tests__/fixtures/process'
import {
  formatIdentityRegistration,
  prepareIdentityRegistration,
  registrationNodeId,
} from '../register'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

test('selects callable authority only for registration via a callable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'astrale-register-principal-'))
  temporaryRoots.push(root)
  const created = await runCli(root, ['identity', 'create', 'alice', '--json'])
  expect(created.exitCode, created.stderr).toBe(0)
  const child = Bun.spawn(['bun', join(import.meta.dir, 'fixtures/register-principal.ts')], {
    env: { ...process.env, ASTRALE_HOME: root, NO_UPDATE_NOTIFIER: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(exit, stderr).toBe(0)
  expect(JSON.parse(stdout)).toEqual([
    { principal: 'callable', path: '/:registration.example:function.registerIdentity' },
    null,
  ])
})

test.each([
  {
    name: 'a missing local identity',
    identity: 'missing',
    prepare: async (_root: string) => {},
    error: {
      error: 'NO_IDENTITY',
      message: 'Identity "missing" not found.',
      hint: 'Run: astrale identity create missing',
    },
  },
  {
    name: 'an IdP identity sharing a local keypair subject',
    identity: 'workos-user',
    prepare: async (root: string) => {
      const setup = Bun.spawn(
        ['bun', join(import.meta.dir, 'fixtures/register-idp-collision.ts')],
        {
          env: { ...process.env, ASTRALE_HOME: root },
          stderr: 'pipe',
        },
      )
      expect(await setup.exited, await new Response(setup.stderr).text()).toBe(0)
    },
    error: {
      error: 'INVALID_IDENTITY_SOURCE',
      message:
        'Identity "workos-user" is IdP-backed and cannot be registered as a local key identity.',
      hint: 'Run: astrale identity create <local-name>',
    },
  },
  {
    name: 'an incomplete keypair',
    identity: 'alice',
    prepare: async (root: string) => {
      const created = await runCli(root, ['identity', 'create', 'alice', '--json'])
      expect(created.exitCode, created.stderr).toBe(0)
      await unlink(keypairPaths('alice', join(root, 'keys')).publicPath)
    },
    error: {
      error: 'IDENTITY_KEYPAIR_INCOMPLETE',
      message: 'Identity "alice" has an incomplete keypair (missing public key).',
      hint: 'Restore or import its complete keypair, or create a different local identity.',
    },
  },
])(
  'refuses $name before connecting to Kernel, changing nothing',
  async ({ identity, prepare, error }) => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-register-refused-'))
    temporaryRoots.push(root)
    await prepare(root)
    const before = await readFile(join(root, 'identities.json'), 'utf8').catch(() => null)
    const observer = await observeConnections()
    try {
      const result = await runCli(root, [
        'identity',
        'register',
        identity,
        '--node',
        '@existing-user-id',
        '--url',
        observer.url,
        '--json',
      ])
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(JSON.parse(result.stderr)).toEqual(error)
      expect(observer.count()).toBe(0)
      expect(await readFile(join(root, 'identities.json'), 'utf8').catch(() => null)).toBe(before)
    } finally {
      await observer.close()
    }
  },
)

/** @evidence TEST-CLI-IDENTITY-REGISTER-JSON-EXACT */
test('emits exactly one structured value for machine registration output', () => {
  const written = spyOn(process.stdout, 'write').mockImplementation(() => true)
  const logged = spyOn(console, 'log').mockImplementation(() => undefined)
  try {
    formatIdentityRegistration(
      { iss: 'https://identity.example', sub: 'self', nodeId: 'operator-node' },
      { json: true },
      true,
    )
    expect(JSON.parse(written.mock.calls.map(([chunk]) => String(chunk)).join(''))).toEqual({
      iss: 'https://identity.example',
      sub: 'self',
      nodeId: 'operator-node',
    })
    expect(logged).not.toHaveBeenCalled()
  } finally {
    written.mockRestore()
    logged.mockRestore()
  }
})

test('registers only the selected existing Node with a verifiable primary self proof', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const privateJwk = { ...(await exportJWK(privateKey)), alg: 'ES256', kid: 'alice-key' }
  const publicJwk = jwk.acceptPublic({
    ...(await exportJWK(publicKey)),
    alg: 'ES256',
    kid: 'alice-key',
  })
  const kernelIssuer = issuer.accept('https://kernel.example')
  const input = {
    nodeId: NodeId('existing-user-id'),
    privateKey: privateJwk,
    publicKey: publicJwk,
    kernelIssuer,
  }
  const prepared = await prepareIdentityRegistration(input)
  const replay = await prepareIdentityRegistration(input)
  expect(prepared.request.idempotencyKey).toMatch(/^identity-register\.[a-f0-9]{64}$/u)
  expect(prepared.request.idempotencyKey).toBe(replay.request.idempotencyKey)
  for (const change of [
    { nodeId: NodeId('another-user') },
    { kernelIssuer: issuer.accept('https://other.example') },
  ]) {
    const other = await prepareIdentityRegistration({ ...input, ...change })
    expect(other.request.idempotencyKey).not.toBe(prepared.request.idempotencyKey)
  }
  expect(Object.keys(prepared.request).sort()).toEqual(['idempotencyKey', 'identities'])

  const designation = prepared.request.identities[0]
  expect(designation).toEqual({
    id: input.nodeId,
    mode: 'self',
    publicKey: publicJwk,
    credential: expect.any(String),
  })
  const expectedIssuer = await register.selfIssuer(kernelIssuer, publicJwk)
  const verified = await jwtVerify(designation.credential, publicKey, {
    algorithms: ['ES256'],
    issuer: expectedIssuer,
    subject: 'self',
    audience: kernelIssuer,
  })
  expect(Object.keys(verified.payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sub'])
  expect(verified.protectedHeader.kid).toBe(publicJwk.kid)
  expect(verified.payload.exp! - verified.payload.iat!).toBe(300)
})

test('requires an explicit Node ID, not a class, callable or caller shorthand', () => {
  expect(registrationNodeId('@existing-user-id')).toBe(NodeId('existing-user-id'))
  for (const value of ['@self', '/:accounts.example:class.User', '@user::whoami', 'user']) {
    expect(() => registrationNodeId(value)).toThrow()
  }
})
