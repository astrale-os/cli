import type { ProvisionRequest } from '@astrale-os/kernel-core/auth'

import { LocalBinding } from '@astrale-os/kernel-core/graph/graph'
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
    identities: {
      identity: {
        credentials: {
          publicKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', alg: 'ES256' },
          proof: 'self-proven-request.jwt.signature',
        },
      },
    },
  } as unknown as ProvisionRequest
  const calls: unknown[] = []
  let directCalls = 0
  const result = await submitIdentityProvision({
    binding,
    request,
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
          identities: {
            identity: { issuer: 'https://identity.example', subject: 'operator-node' },
          },
        }
      },
    },
  })

  expect(directCalls).toBe(0)
  expect(calls).toHaveLength(1)
  expect(JSON.parse(JSON.stringify(calls[0]))).toEqual({
    target: { kind: 'path', path: '/:ops.example:function.provisionOperator' },
    input: JSON.parse(JSON.stringify(request)),
  })
  expect(result).toEqual({
    iss: 'https://identity.example',
    sub: 'operator-node',
    nodeId: 'operator-node',
  })
})
