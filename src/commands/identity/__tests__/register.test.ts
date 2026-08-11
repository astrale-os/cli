import { issuer, jwk, provision } from '@astrale-os/kernel-core/auth'
import { ClassPath } from '@astrale-os/kernel-core/graph/class'
import { normalizeProperties } from '@astrale-os/kernel-core/graph/properties'
import { expect, test } from 'bun:test'
import { exportJWK, generateKeyPair, jwtVerify } from 'jose'

import { prepareIdentityProvision } from '../register'

test('builds one exact Mutation V2 identity birth bound to a self proof', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const privateJwk = { ...(await exportJWK(privateKey)), alg: 'ES256', kid: 'alice-key' }
  const publicJwk = jwk.acceptPublic({
    ...(await exportJWK(publicKey)),
    alg: 'ES256',
    kid: 'alice-key',
  })
  const kernelIssuer = issuer.accept('https://kernel.example')
  const classPath = ClassPath.parse('/:accounts.example:class.User')
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
    version: 'v2',
    preconditions: [],
    operations: [
      {
        op: 'node.create',
        as: 'identity',
        class: '/:accounts.example:class.User',
        props: { 'accounts.example:class.User.property.name': 'Alice' },
      },
    ],
  })

  const credentials = prepared.request.identities[prepared.binding]?.credentials
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
