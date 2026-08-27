import { issuer, jwk, provision } from '@astrale-os/sdk/auth'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { expect, mock, test } from 'bun:test'
import { exportJWK, generateKeyPair, jwtVerify } from 'jose'

import { classKey } from '../../../graph'
import { formatIdentityRegistration, prepareIdentityProvision } from '../register'

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

test('builds one exact Mutation V3 identity birth bound to a self proof', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const privateJwk = { ...(await exportJWK(privateKey)), alg: 'ES256', kid: 'alice-key' }
  const publicJwk = jwk.acceptPublic({
    ...(await exportJWK(publicKey)),
    alg: 'ES256',
    kid: 'alice-key',
  })
  const kernelIssuer = issuer.accept('https://kernel.example')
  const classPath = classKey('/:accounts.example:class.User', '--class')
  const properties = normalizeProperties({
    'accounts.example:class.User.property.name': 'Alice',
  })

  const prepared = await prepareIdentityProvision({
    name: 'alice',
    classPath,
    properties,
    privateKey: privateJwk,
    publicKey: publicJwk,
    kernelIssuer,
  })

  expect(String(prepared.binding)).toBe('identity')
  expect(prepared.request.idempotencyKey).toBe('identity-register:alice')
  expect(JSON.parse(JSON.stringify(prepared.request.mutation))).toEqual({
    format: 'astrale.graph.mutation',
    version: 'v3',
    preconditions: [],
    operations: [
      {
        op: 'node.create',
        as: 'identity',
        class: 'accounts.example:class.User',
        props: { 'accounts.example:class.User.property.name': 'Alice' },
      },
    ],
  })

  const designation = prepared.request.identities[0]
  expect(designation.identity).toEqual({ created: prepared.binding })
  const authentication = designation.authentication
  const credentials =
    authentication !== undefined && 'credentials' in authentication
      ? authentication.credentials
      : undefined
  expect(credentials?.publicKey).toEqual(publicJwk)
  expect(typeof credentials?.proof).toBe('string')
  if (typeof credentials?.proof !== 'string') throw new TypeError('Expected compact JWT proof')

  const expectedFingerprint = await provision.fingerprint(prepared.request)
  const expectedIssuer = await provision.selfIssuer(kernelIssuer, publicJwk)
  const verified = await jwtVerify(credentials.proof, publicKey, {
    algorithms: ['ES256'],
    issuer: expectedIssuer,
    subject: 'self',
    audience: kernelIssuer,
  })
  expect(verified.payload.provision).toBe(expectedFingerprint)
})
