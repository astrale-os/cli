import { issuer } from '@astrale-os/sdk/auth'
import { Path } from '@astrale-os/sdk/graph/path'
import { bundle, defineSchema, func, method, nodeClass, classIcon } from '@astrale-os/sdk/schema'
import { expect, test } from 'bun:test'

import type { ConnectionContext } from '../../connection'

import { acceptExecutionReceipt, parseExecutionReceipt } from '../../connection/execution'
import { materializeCallResult } from '../call'
import { startExecution } from '../execution'

const durable = func({
  auth: 'authenticated',
  execution: { durable: true },
  input: { type: 'object' },
  output: { type: 'object' },
})
const ordinary = func({
  auth: 'authenticated',
  input: { type: 'object' },
  output: { type: 'object' },
})
const installed = bundle.create(
  defineSchema('jobs.example', {
    name: 'Jobs',
    functions: { durable, ordinary },
    classes: {
      Job: nodeClass({
        icon: classIcon.neutral,
        methods: {
          complete: method({
            auth: 'authenticated',
            execution: { durable: true },
            input: { type: 'object' },
            output: { type: 'object' },
          }),
        },
      }),
    },
  }),
)

function fixture() {
  const calls: unknown[] = []
  const context = {
    target: {
      kernelIssuer: issuer.accept('https://kernel.example'),
      domainIssuer: issuer.accept('https://domain.example'),
    },
    self: async () => ({ id: 'alice' }),
    session: {
      schema: { bundle: async () => ({ bundle: installed }) },
      invoke: async (call: unknown) => {
        calls.push(call)
        return { id: 'execution-1' }
      },
    },
  } as unknown as ConnectionContext
  return { context, calls }
}

test('declared durable start emits a nonsecret portable receipt across JSON round trips', async () => {
  const { context, calls } = fixture()
  const receipt = await startExecution(
    context,
    Path.parse('/:jobs.example:function.durable'),
    {},
    false,
  )
  expect(receipt).toMatchObject({
    kind: 'astrale.execution',
    version: 1,
    id: 'execution-1',
    caller: 'alice',
    origin: 'jobs.example',
    kernel: 'https://kernel.example',
    principal: 'domain',
  })
  expect(acceptExecutionReceipt(JSON.parse(JSON.stringify(receipt)))).toEqual(receipt)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({
    fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    callable: 'jobs.example:function.durable',
  })
})

test('ordinary id-shaped output is never dispatched or misclassified as a workflow', async () => {
  const { context, calls } = fixture()
  await expect(
    startExecution(context, Path.parse('/:jobs.example:function.ordinary'), {}, false),
  ).rejects.toMatchObject({ code: 'EXECUTION_NOT_DURABLE' })
  expect(calls).toEqual([])
  expect(
    await materializeCallResult({
      kind: 'value',
      invocation: { source: issuer.accept('https://kernel.example'), id: 'i' },
      value: { id: 'execution-1' },
    }),
  ).toMatchObject({
    kind: 'value',
    value: { id: 'execution-1' },
  })
  expect(() => acceptExecutionReceipt({ id: 'execution-1' })).toThrow()
})

test('receipt rejects unknown versions, extra credentials and path-shaped origins', async () => {
  const { context } = fixture()
  const receipt = await startExecution(
    context,
    Path.parse('/:jobs.example:function.durable'),
    {},
    false,
  )
  for (const changes of [
    { version: 2 },
    { credential: 'not-accepted' },
    { origin: 'jobs.example:function.durable' },
    { kernel: 'not-an-issuer' },
  ]) {
    expect(() => acceptExecutionReceipt({ ...receipt, ...changes })).toThrow()
  }
})

test('durable instance methods retain the qualified declaring Domain and exact receiver', async () => {
  const { context, calls } = fixture()
  const receipt = await startExecution(
    context,
    Path.parse('@job::jobs.example:class.Job.method.complete'),
    {},
    false,
  )
  expect(receipt.origin).toBe('jobs.example')
  expect(calls[0]).toMatchObject({
    callable: 'jobs.example:class.Job.method.complete',
    target: { raw: '@job::jobs.example:class.Job.method.complete' },
    fingerprint: expect.stringMatching(/^sha256:/),
  })
})

test('malformed receipt JSON never echoes file contents', () => {
  expect(() => parseExecutionReceipt('private-content-not-json')).toThrow(
    'The execution receipt file must contain valid JSON.',
  )
})
