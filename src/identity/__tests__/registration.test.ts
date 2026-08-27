import type { ProvisionRequest } from '@astrale-os/sdk/auth'

import { LocalBinding } from '@astrale-os/sdk/graph'
import { expect, test } from 'bun:test'

import { submitIdentityProvision } from '../registration'

/** @evidence TEST-CLI-IDENTITY-REGISTER-DOMAIN-MEDIATED */
test('submits the exact self-proven request through an explicit Domain callable', async () => {
  const binding = LocalBinding('identity')
  const request = {
    idempotencyKey: 'identity-register:operator',
    mutation: {
      format: 'astrale.graph.mutation',
      version: 'v2',
      preconditions: [],
      operations: [],
    },
    identities: [
      {
        identity: { created: binding },
        authentication: {
          credentials: {
            publicKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', alg: 'ES256' },
            proof: 'self-proven-request.jwt.signature',
          },
        },
      },
    ],
  } as unknown as ProvisionRequest
  const calls: unknown[] = []
  let directCalls = 0
  const result = await submitIdentityProvision({
    binding,
    request,
    expected: { iss: 'https://identity.example', sub: 'self' },
    via: '/:ops.example:function.provisionOperator',
    direct: {
      async provision() {
        directCalls += 1
        throw new Error('direct provision must not run')
      },
    },
    callable: {
      async call(call) {
        calls.push(call)
        return {
          createdNodes: { identity: 'operator-node' },
          identities: [{ id: 'operator-node', iss: 'https://identity.example', sub: 'self' }],
        }
      },
    },
  })

  expect(directCalls).toBe(0)
  expect(calls).toHaveLength(1)
  expect(JSON.parse(JSON.stringify(calls[0]))).toEqual({
    target: '/:ops.example:function.provisionOperator',
    input: JSON.parse(JSON.stringify(request)),
  })
  expect(result).toEqual({
    iss: 'https://identity.example',
    sub: 'self',
    nodeId: 'operator-node',
  })
})

test('rejects a provision response that does not identify the prepared created Node', async () => {
  const binding = LocalBinding('identity')
  await expect(
    submitIdentityProvision({
      binding,
      request: {} as ProvisionRequest,
      expected: { iss: 'https://identity.example', sub: 'self' },
      direct: {
        async provision() {
          return {
            createdNodes: { identity: 'operator-node' },
            identities: [
              { id: 'different-node', iss: 'https://identity.example', sub: 'operator-node' },
            ],
          }
        },
      },
      callable: {
        async call() {
          throw new Error('callable provision must not run')
        },
      },
    }),
  ).rejects.toThrow('must contain the one created Identity')
})

test('rejects duplicate Identity entries for the prepared created Node', async () => {
  const binding = LocalBinding('identity')
  await expect(
    submitIdentityProvision({
      binding,
      request: {} as ProvisionRequest,
      expected: { iss: 'https://identity.example', sub: 'self' },
      direct: {
        async provision() {
          return {
            createdNodes: { identity: 'operator-node' },
            identities: [
              { id: 'operator-node', iss: 'https://identity.example', sub: 'self' },
              { id: 'operator-node', iss: 'https://attacker.example', sub: 'forged' },
            ],
          }
        },
      },
      callable: {
        async call() {
          throw new Error('callable provision must not run')
        },
      },
    }),
  ).rejects.toThrow('must contain the one created Identity')
})

test.each([
  ['issuer', { iss: 'https://attacker.example', sub: 'self' }],
  ['subject', { iss: 'https://identity.example', sub: 'operator-node' }],
] as const)(
  'rejects a provision response with a forged %s coordinate',
  async (_label, identity) => {
    const binding = LocalBinding('identity')
    await expect(
      submitIdentityProvision({
        binding,
        request: {} as ProvisionRequest,
        expected: { iss: 'https://identity.example', sub: 'self' },
        direct: {
          async provision() {
            return {
              createdNodes: { identity: 'operator-node' },
              identities: [{ id: 'operator-node', ...identity }],
            }
          },
        },
        callable: {
          async call() {
            throw new Error('callable provision must not run')
          },
        },
      }),
    ).rejects.toThrow('does not match the self-proven Authentication')
  },
)
