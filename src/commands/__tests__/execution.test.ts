import { issuer } from '@astrale-os/sdk/auth'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { Path } from '@astrale-os/sdk/graph/path'
import { expect, test } from 'bun:test'

import type { ConnectionContext } from '../../connection'

import { acceptExecutionReceipt, parseExecutionReceipt } from '../../connection/execution'
import { executionReceipt } from '../execution'

function context(principal: () => string = () => 'domain') {
  return {
    target: { kernelIssuer: issuer.accept('https://kernel.example') },
    credentialPrincipal: principal,
  } as unknown as ConnectionContext
}
const started = NodeId('execution-1')

test('a started Execution yields a nonsecret portable receipt across JSON round trips', () => {
  const receipt = executionReceipt(
    context(),
    Path.parse('/:jobs.example:function.durable'),
    started,
  )
  const wire = JSON.parse(JSON.stringify(receipt))
  expect(wire).toEqual({
    kind: 'astrale.execution',
    version: 2,
    id: 'execution-1',
    kernel: 'https://kernel.example',
    origin: 'jobs.example',
    principal: 'domain',
  })
  expect(acceptExecutionReceipt(wire)).toEqual(receipt)
})

test('the receipt records the selected credential principal and the declaring Domain of a method', () => {
  const receipt = executionReceipt(
    context(() => 'caller'),
    Path.parse('@job::jobs.example:class.Job.method.complete'),
    started,
  )
  expect(receipt).toMatchObject({ origin: 'jobs.example', principal: 'caller' })
})

test('receipt rejects earlier versions, unknown fields and path-shaped origins', () => {
  const receipt = executionReceipt(
    context(),
    Path.parse('/:jobs.example:function.durable'),
    started,
  )
  for (const changes of [
    { version: 1 },
    { caller: 'alice' },
    { id: '@execution-1' },
    { credential: 'not-accepted' },
    { origin: 'jobs.example:function.durable' },
    { kernel: 'not-an-issuer' },
    { kernel: 'https://kernel.example/' },
    { kernel: 'https://KERNEL.example' },
    { kernel: 'https://kernel.example:443' },
  ]) {
    expect(() => acceptExecutionReceipt({ ...receipt, ...changes })).toThrow()
  }
})

test('an unrecordable start context retains only the Execution ID and forbids a second call', () => {
  const failure = () => {
    throw new Error('private failure details')
  }
  for (const [ctx, path] of [
    [context(failure), Path.parse('/:jobs.example:function.durable')],
    [context(), Path.parse('@durable-function')],
  ] as const) {
    expect(() => executionReceipt(ctx, path, started)).toThrow(
      expect.objectContaining({
        code: 'EXECUTION_RECEIPT_INVALID',
        message:
          'The call started Execution execution-1, but its observation receipt could not be constructed.',
        hint: 'Retain Execution ID execution-1 and reconstruct its receipt from the initiating context. Do not call again.',
      }),
    )
  }
})

test('invalid receipts are rejected without echoing their contents', () => {
  expect(() => parseExecutionReceipt('private-content-not-json')).toThrow(
    'The execution receipt file must contain valid JSON.',
  )
  const receipt = executionReceipt(
    context(),
    Path.parse('/:jobs.example:function.durable'),
    started,
  )
  try {
    acceptExecutionReceipt({ ...receipt, id: 'private input: not a NodeId' })
    throw new Error('expected invalid receipt')
  } catch (error) {
    expect(String(error)).toBe('TypeError: Expected an astrale.execution version 2 receipt.')
    expect(error).not.toHaveProperty('input')
  }
})
