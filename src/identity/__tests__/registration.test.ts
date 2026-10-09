import type { RegisterRequest } from '@astrale-os/sdk/auth'

import { issuer } from '@astrale-os/sdk/auth'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { expect, test } from 'bun:test'

import { acceptRegisteredIdentity, submitIdentityRegistration } from '../registration'

const nodeId = NodeId('operator-node')
const authentication = { iss: issuer.accept('https://identity.example'), sub: 'self' as const }
const result = { identities: [{ id: nodeId, ...authentication }] }
const request: RegisterRequest = {
  idempotencyKey: 'identity-register.fixture',
  identities: [
    {
      id: nodeId,
      mode: 'self',
      publicKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', alg: 'ES256' },
      credential: 'primary.jwt.signature',
    },
  ],
}

/** @evidence TEST-CLI-IDENTITY-REGISTER-DOMAIN-MEDIATED */
test.each([undefined, '/:ops.example:function.registerOperator'])(
  'submits exactly the existing-Node request via %s',
  async (via) => {
    const calls: unknown[] = []
    const registered = await submitIdentityRegistration({
      request,
      nodeId,
      expectedAuthentication: authentication,
      ...(via === undefined ? {} : { via }),
      direct: {
        async register(value) {
          expect(via).toBeUndefined()
          calls.push(value)
          return result
        },
      },
      callable: {
        async call(value) {
          expect(via).toBeDefined()
          calls.push(value)
          return result
        },
      },
    })
    expect(JSON.parse(JSON.stringify(calls))).toEqual([
      via === undefined ? request : { target: via, input: request },
    ])
    expect(registered).toEqual({ ...authentication, nodeId })
  },
)

test('rejects substitution, duplicates and the removed result shape', () => {
  for (const identities of [
    [],
    [{ id: 'other', ...authentication }],
    [...result.identities, ...result.identities],
  ]) {
    expect(() => acceptRegisteredIdentity({ identities }, nodeId, authentication)).toThrow(
      'Register result must contain exactly one Identity for the selected Node.',
    )
  }
  for (const mismatch of [{ iss: 'https://attacker.example' }, { sub: 'other' }]) {
    expect(() =>
      acceptRegisteredIdentity(
        { identities: [{ id: nodeId, ...authentication, ...mismatch }] },
        nodeId,
        authentication,
      ),
    ).toThrow('Register result substituted the prepared Authentication.')
  }
  expect(() =>
    acceptRegisteredIdentity({ identities: { identity: authentication } }, nodeId, authentication),
  ).toThrow('Register result identities must be an array.')
})

test('propagates an unknown outcome without retrying or falling back to another authority', async () => {
  let attempts = 0
  const error = new Error('response lost')
  await expect(
    submitIdentityRegistration({
      request,
      nodeId,
      expectedAuthentication: authentication,
      direct: {
        async register() {
          attempts++
          throw error
        },
      },
      callable: {
        async call() {
          throw new Error('unexpected fallback')
        },
      },
    }),
  ).rejects.toBe(error)
  expect(attempts).toBe(1)
})
