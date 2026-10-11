import type { RegisterRequest } from '@astrale-os/sdk/auth'

import { issuer } from '@astrale-os/sdk/auth'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { expect, test } from 'bun:test'

import { submitIdentityRegistration } from '../registration'

const nodeId = NodeId('operator-node')
const authentication = { iss: issuer.accept('https://identity.example'), sub: 'self' as const }
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

/** Submit `request` directly or `via` a callable; the Kernel answers `answer`. */
function submit(answer: () => unknown, via?: string) {
  const calls: unknown[] = []
  const registered = submitIdentityRegistration({
    request,
    nodeId,
    expectedAuthentication: authentication,
    ...(via === undefined ? {} : { via }),
    direct: { register: async (value) => (calls.push(value), answer()) },
    callable: { call: async (value) => (calls.push(value), answer()) },
  })
  return { calls, registered }
}

/** @evidence TEST-CLI-IDENTITY-REGISTER-DOMAIN-MEDIATED */
test.each([undefined, '/:ops.example:function.registerOperator'])(
  'submits exactly the existing-Node request via %s',
  async (via) => {
    const { calls, registered } = submit(
      () => ({ identities: [{ id: nodeId, ...authentication }] }),
      via,
    )
    expect(await registered).toEqual({ ...authentication, nodeId })
    expect(JSON.parse(JSON.stringify(calls))).toEqual([
      via === undefined ? request : { target: via, input: request },
    ])
  },
)

test('refuses a result that substitutes the Node or its Authentication', async () => {
  for (const identities of [
    [{ id: 'other', ...authentication }],
    [
      { id: nodeId, ...authentication },
      { id: nodeId, ...authentication },
    ],
    [{ id: nodeId, ...authentication, iss: 'https://attacker.example' }],
  ]) {
    await expect(submit(() => ({ identities })).registered).rejects.toThrow(TypeError)
  }
})

test('propagates an unknown outcome without retrying or falling back to another authority', async () => {
  const error = new Error('response lost')
  const { calls, registered } = submit(() => {
    throw error
  })
  await expect(registered).rejects.toBe(error)
  expect(calls).toHaveLength(1)
})
