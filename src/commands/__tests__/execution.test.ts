import { issuer } from '@astrale-os/sdk/auth'
import { ClientSession } from '@astrale-os/sdk/client/session'
import { Path } from '@astrale-os/sdk/graph/path'
import {
  bundle,
  defineSchema,
  func,
  method,
  nodeClass,
  classIcon,
  schema,
} from '@astrale-os/sdk/schema'
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
    credentialPrincipal: () => 'domain',
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
    { id: '@execution-1' },
    { caller: '@alice' },
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

test('receipt records actual caller credential after a remote target has moved to Kernel hosting', async () => {
  const { context } = fixture()
  expect(context.target.domainIssuer).toBeDefined()
  const receipt = await startExecution(
    { ...context, credentialPrincipal: () => 'caller' },
    Path.parse('/:jobs.example:function.durable'),
    {},
    false,
  )
  expect(receipt.principal).toBe('caller')
})

test('a malformed durable result reports unknown outcome without starting again', async () => {
  const { context } = fixture()
  let calls = 0
  const session = {
    ...context.session,
    schema: context.session.schema,
    invoke: async () => {
      calls++
      return 42
    },
  } as unknown as ConnectionContext['session']
  await expect(
    startExecution(
      { ...context, session },
      Path.parse('/:jobs.example:function.durable'),
      {},
      false,
    ),
  ).rejects.toMatchObject({ code: 'EXECUTION_RECEIPT_INVALID' })
  expect(calls).toBe(1)
})

test('start uses the real SDK wire target with a server-enforced durable meaning fingerprint', async () => {
  const { context } = fixture()
  const observed: { target: unknown; input: unknown }[] = []
  const session = new ClientSession({
    kernel: context.target.kernelIssuer,
    policy: { maximumRouteAgeMs: 60000 },
    envelopeTransport: 'http',
    routeStore: { read: () => undefined, write: () => undefined },
    fetch: async (url, init) => {
      const body = JSON.parse(await new Response(init?.body).text())
      observed.push(body.call)
      const response = new Response(
        JSON.stringify({
          requestId: body.requestId,
          invocation: { source: context.target.kernelIssuer, id: 'start' },
          result: { id: 'execution-1' },
        }),
        {
          headers: {
            'cache-control': 'no-store',
            'content-type': new Headers(init?.headers).get('accept')!,
          },
        },
      )
      Object.defineProperty(response, 'url', { value: String(url) })
      return response
    },
  })
  const proxy = new Proxy(session, {
    get(target, key) {
      if (key === 'schema') return { ...target.schema, bundle: async () => ({ bundle: installed }) }
      const member = Reflect.get(target, key, target)
      return typeof member === 'function' ? member.bind(target) : member
    },
  })
  try {
    await startExecution(
      { ...context, session: proxy },
      Path.parse('/:jobs.example:function.durable'),
      {},
      false,
    )
    const durableMeaning = schema.resolve(installed.root).functions.durable!
    const replacement = schema.resolve(
      bundle.create(
        defineSchema('jobs.example', {
          name: 'Jobs',
          functions: {
            durable: func({
              auth: 'authenticated',
              input: { type: 'object' },
              output: { type: 'object' },
            }),
          },
        }),
      ).root,
    ).functions.durable!
    expect(observed).toEqual([
      {
        target: {
          callable: 'jobs.example:function.durable',
          fingerprint: schema.callableFingerprint(durableMeaning),
        },
        input: {},
      },
    ])
    expect(schema.callableFingerprint(replacement)).not.toBe(
      schema.callableFingerprint(durableMeaning),
    )
  } finally {
    session.close()
  }
})
