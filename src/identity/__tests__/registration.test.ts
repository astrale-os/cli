import type { ProvisionRequest } from '@astrale-os/sdk/auth'

import { issuer } from '@astrale-os/sdk/auth'
import { LocalBinding } from '@astrale-os/sdk/graph'
import { expect, test } from 'bun:test'

import { acceptProvisionedIdentity, submitIdentityProvision } from '../registration'

/** @evidence TEST-CLI-IDENTITY-REGISTER-DOMAIN-MEDIATED */
test('submits the exact self-proven request through an explicit Domain callable', async () => {
  const binding = LocalBinding('identity')
  const request = selfProvenRequest(binding)
  const expectedAuthentication = selfAuthentication()
  const calls: unknown[] = []
  let directCalls = 0
  const result = await submitIdentityProvision({
    binding,
    request,
    expectedAuthentication,
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
          identities: [
            { id: 'unrelated-node' },
            { id: 'operator-node', iss: 'https://identity.example', sub: 'self' },
          ],
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

test('submits directly through caller authority without invoking a Domain callable', async () => {
  const binding = LocalBinding('identity')
  const request = selfProvenRequest(binding)
  const directRequests: ProvisionRequest[] = []
  let callableCalls = 0
  const result = await submitIdentityProvision({
    binding,
    request,
    expectedAuthentication: selfAuthentication(),
    direct: {
      async provision(candidate) {
        directRequests.push(candidate)
        return selfProvisionResult()
      },
    },
    callable: {
      async call() {
        callableCalls += 1
        throw new Error('Domain callable must not run')
      },
    },
  })

  expect(directRequests).toEqual([request])
  expect(callableCalls).toBe(0)
  expect(result).toEqual({
    iss: 'https://identity.example',
    sub: 'self',
    nodeId: 'operator-node',
  })
})

test('rejects a callable result that substitutes or duplicates the prepared Identity', () => {
  const binding = LocalBinding('identity')
  const expectedAuthentication = selfAuthentication()
  const substituted = {
    createdNodes: { identity: 'operator-node' },
    identities: [{ id: 'different-node', iss: 'https://identity.example', sub: 'self' }],
  }
  expect(() => acceptProvisionedIdentity(substituted, binding, expectedAuthentication)).toThrow(
    'Provision result must contain exactly one Identity for the prepared binding.',
  )

  const duplicate = {
    createdNodes: { identity: 'operator-node' },
    identities: [
      { id: 'operator-node', iss: 'https://identity.example', sub: 'self' },
      { id: 'operator-node', iss: 'https://identity.example', sub: 'self' },
    ],
  }
  expect(() => acceptProvisionedIdentity(duplicate, binding, expectedAuthentication)).toThrow(
    'Provision result must contain exactly one Identity for the prepared binding.',
  )

  const substitutedAuthentication = {
    createdNodes: { identity: 'operator-node' },
    identities: [{ id: 'operator-node', iss: 'https://attacker.example', sub: 'attacker' }],
  }
  expect(() =>
    acceptProvisionedIdentity(substitutedAuthentication, binding, expectedAuthentication),
  ).toThrow('Provision result substituted the prepared Authentication.')
})

test('rejects the removed binding-keyed provision result shape', () => {
  expect(() =>
    acceptProvisionedIdentity(
      {
        createdNodes: { identity: 'operator-node' },
        identities: {
          identity: { issuer: 'https://identity.example', subject: 'self' },
        },
      },
      LocalBinding('identity'),
      selfAuthentication(),
    ),
  ).toThrow('Provision result identities must be an array.')
})

function selfAuthentication() {
  return Object.freeze({ iss: issuer.accept('https://identity.example'), sub: 'self' as const })
}

function selfProvisionResult() {
  return {
    createdNodes: { identity: 'operator-node' },
    identities: [
      { id: 'unrelated-node' },
      { id: 'operator-node', iss: 'https://identity.example', sub: 'self' },
    ],
  }
}

function selfProvenRequest(binding: ReturnType<typeof LocalBinding>): ProvisionRequest {
  return {
    idempotencyKey: `identity-register.${'a'.repeat(64)}`,
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
}
