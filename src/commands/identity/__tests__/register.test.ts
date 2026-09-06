import { issuer, jwk, register } from '@astrale-os/sdk/auth'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { afterEach, expect, mock, test } from 'bun:test'
import { exportJWK, generateKeyPair, jwtVerify } from 'jose'
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { keypairPaths } from '../../../keys'
import {
  formatIdentityRegistration,
  prepareIdentityRegistration,
  registrationNodeId,
} from '../register'

const cliRoot = join(import.meta.dir, '../../../..')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function runCli(root: string, args: readonly string[]) {
  const child = Bun.spawn(['bun', join(cliRoot, 'bin/astrale.ts'), ...args], {
    env: { ...process.env, ASTRALE_HOME: root, NO_UPDATE_NOTIFIER: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

async function observeConnections() {
  let connections = 0
  const server = createServer((socket) => {
    connections += 1
    socket.destroy()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected an observing TCP port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    count: () => connections,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

test('reports a missing local identity before connecting to Kernel', async () => {
  const root = await mkdtemp(join(tmpdir(), 'astrale-register-missing-'))
  temporaryRoots.push(root)
  const observer = await observeConnections()

  try {
    const result = await runCli(root, [
      'identity',
      'register',
      'missing',
      '--node',
      '@existing-user-id',
      '--url',
      observer.url,
      '--json',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toEqual({
      error: 'NO_IDENTITY',
      message: 'Identity "missing" not found.',
      hint: 'Run: astrale identity create missing',
    })
    expect(observer.count()).toBe(0)
  } finally {
    await observer.close()
  }
})

test('rejects an IdP identity before using a colliding local keypair or Kernel', async () => {
  const root = await mkdtemp(join(tmpdir(), 'astrale-register-idp-'))
  temporaryRoots.push(root)
  const observer = await observeConnections()
  const setup = Bun.spawn(['bun', join(import.meta.dir, 'fixtures', 'register-idp-collision.ts')], {
    env: { ...process.env, ASTRALE_HOME: root },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [setupExit, setupStderr] = await Promise.all([
    setup.exited,
    new Response(setup.stderr).text(),
  ])
  expect(setupExit, setupStderr).toBe(0)

  try {
    const before = await readFile(join(root, 'identities.json'), 'utf8')
    const result = await runCli(root, [
      'identity',
      'register',
      'workos-user',
      '--node',
      '@existing-user-id',
      '--url',
      observer.url,
      '--json',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toEqual({
      error: 'INVALID_IDENTITY_SOURCE',
      message:
        'Identity "workos-user" is IdP-backed and cannot be registered as a local key identity.',
      hint: 'Run: astrale identity create <local-name>',
    })
    expect(observer.count()).toBe(0)
    expect(await readFile(join(root, 'identities.json'), 'utf8')).toBe(before)
  } finally {
    await observer.close()
  }
})

test('reports an incomplete keypair exactly before connecting to Kernel', async () => {
  const root = await mkdtemp(join(tmpdir(), 'astrale-register-keypair-'))
  temporaryRoots.push(root)
  const created = await runCli(root, ['identity', 'create', 'alice', '--json'])
  expect(created.exitCode, created.stderr).toBe(0)
  await unlink(keypairPaths('alice', join(root, 'keys')).publicPath)
  const observer = await observeConnections()

  try {
    const result = await runCli(root, [
      'identity',
      'register',
      'alice',
      '--node',
      '@existing-user-id',
      '--url',
      observer.url,
      '--json',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toEqual({
      error: 'IDENTITY_KEYPAIR_INCOMPLETE',
      message: 'Identity "alice" has an incomplete keypair (missing public key).',
      hint: 'Restore or import its complete keypair, or create a different local identity.',
    })
    expect(observer.count()).toBe(0)
  } finally {
    await observer.close()
  }
})

/** @evidence TEST-CLI-IDENTITY-REGISTER-JSON-EXACT */
test('emits exactly one structured value for machine registration output', () => {
  const writes: string[] = []
  const logs: string[] = []
  const originalWrite = process.stdout.write
  const originalLog = console.log
  process.stdout.write = mock((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
    return true
  }) as typeof process.stdout.write
  console.log = mock((...values: unknown[]) => logs.push(values.map(String).join(' ')))

  try {
    formatIdentityRegistration(
      { iss: 'https://identity.example', sub: 'self', nodeId: 'operator-node' },
      { json: true },
      true,
    )
  } finally {
    process.stdout.write = originalWrite
    console.log = originalLog
  }

  expect(JSON.parse(writes.join(''))).toEqual({
    iss: 'https://identity.example',
    sub: 'self',
    nodeId: 'operator-node',
  })
  expect(logs).toEqual([])
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
