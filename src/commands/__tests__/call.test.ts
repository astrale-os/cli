import { describe, expect, test } from 'bun:test'

import type { ConnectionContext } from '../../connection'

import { callCommand, materializeCallResult } from '../call'
import { human } from './fixtures/process'

describe('call command target and dry run', () => {
  /** Run `call` with a dry-run connection that resolves @self to alice and never dispatches. */
  async function call(target: string, params: string[], opts: Record<string, unknown>) {
    const run = { connections: 0, credential: undefined as unknown, rendered: undefined as unknown }
    const context = {
      self: async () => ({ id: 'alice' }),
      target: {},
      session: {
        async dispatch() {
          throw new Error('dry run must not dispatch')
        },
      },
    } as unknown as ConnectionContext
    await callCommand(target, params, opts, {
      async runKernelCommand(input) {
        run.connections += 1
        run.credential = input.credential
        if (opts.dryRun !== true) return
        await input.format?.(await input.fn(context), input.opts, true)
      },
      output: (value) => void (run.rendered = plainCall(value)),
    })
    return run
  }

  test('a dry run admits --data verbatim without a Kernel connection, @self included', async () => {
    const target = '/:shipment.example:function.dispatch'
    for (const data of ['{"reference":"SHIP-1"}', '{"owner":"@self"}']) {
      const run = await call(target, [], { dryRun: true, data, json: true })
      expect(run).toMatchObject({ connections: 0, rendered: { target, input: JSON.parse(data) } })
    }
  })

  test('a dry run resolves @self in key=value params inside the command session', async () => {
    const target = '/:shipment.example:function.dispatch'
    const run = await call(target, ['owner=@self'], { dryRun: true, json: true })
    expect(run).toEqual({
      connections: 1,
      credential: { principal: 'caller' },
      rendered: { target, input: { owner: '@alice' } },
    })
  })

  test('an ordinary call selects credentials for its executable Domain', async () => {
    const run = await call('@worker::services.example:class.Worker.method.logs', ['tail=1'], {
      json: true,
    })
    expect(run.credential).toMatchObject({ principal: 'callable' })
  })
})

function plainCall(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('target' in value) || !('input' in value)) {
    return value
  }
  const target = value.target
  return {
    target: typeof target === 'object' && target !== null && 'raw' in target ? target.raw : target,
    input: value.input,
  }
}

describe('call command result lifetime', () => {
  /** @evidence TEST-CLI-CALL-DRAINS-STREAM-IN-CONNECTION-ACTION */
  test('drains a session-backed stream before returning it for presentation', async () => {
    let sessionOpen = true
    async function* stream() {
      for (const value of ['first', 'second']) {
        if (!sessionOpen) throw new Error('session closed before stream consumption')
        yield value
      }
    }

    const sessionStream = Object.assign(stream(), { async cancel() {} })
    const materialized = await materializeCallResult({
      kind: 'stream',
      invocation: { source: 'https://kernel.test' as never, id: 'test-stream' },
      stream: sessionStream,
    })
    sessionOpen = false

    expect(materialized).toEqual({ kind: 'stream', values: ['first', 'second'] })
    expect(Object.isFrozen(materialized)).toBe(true)
    if (materialized.kind !== 'stream') throw new Error('expected a materialized stream')
    expect(Object.isFrozen(materialized.values)).toBe(true)
  })

  test('drains streaming binary bytes before the command session closes', async () => {
    let sessionOpen = true
    async function* body() {
      for (const chunk of [new Uint8Array([1, 2]), new Uint8Array([3])]) {
        if (!sessionOpen) throw new Error('session closed before binary consumption')
        yield chunk
      }
    }

    const materialized = await materializeCallResult({
      kind: 'binary',
      invocation: { source: 'https://kernel.test' as never, id: 'test-binary' },
      value: {
        body: body(),
        mediaType: 'application/octet-stream',
        status: 206,
        headers: { 'content-range': 'bytes 0-2/3' },
      },
    })
    sessionOpen = false

    expect(materialized).toMatchObject({
      kind: 'binary',
      value: {
        mediaType: 'application/octet-stream',
        status: 206,
        headers: { 'content-range': 'bytes 0-2/3' },
      },
    })
    if (materialized.kind !== 'binary') throw new Error('expected materialized binary')
    expect([...materialized.value.body]).toEqual([1, 2, 3])
    expect(Object.isFrozen(materialized.value)).toBe(true)
  })
})

describe('call command durable answer', () => {
  const invocation = { source: 'https://kernel.example', id: 'call-1' }

  /** The outcome `call` hands to presentation for one Kernel answer. */
  async function outcome(answer: unknown) {
    const context = {
      target: { kernelIssuer: 'https://kernel.example' },
      credentialPrincipal: () => 'domain',
      session: { dispatch: async () => answer },
    } as unknown as ConnectionContext
    let result: unknown
    await callCommand(
      '/:jobs.example:function.hold',
      ['invoice=inv-1'],
      { json: true },
      {
        async runKernelCommand(input) {
          result = await input.fn(context)
        },
        output: () => {},
      },
    )
    return result
  }

  test('prints the receipt of the Execution a durable callable started', async () => {
    expect(await outcome({ kind: 'execution', invocation, execution: 'run-1' })).toEqual({
      kind: 'execution',
      receipt: {
        kind: 'astrale.execution',
        version: 2,
        id: 'run-1',
        kernel: 'https://kernel.example',
        origin: 'jobs.example',
        principal: 'domain',
      },
      replayed: false,
    })
  })

  test('a durable answer the Kernel marks a replay says so once; the receipt is unchanged', async () => {
    const answer = { kind: 'execution', invocation, execution: 'run-1', replayed: true }
    const replayed = (await outcome(answer)) as { readonly receipt: unknown }
    expect(replayed).toMatchObject({ replayed: true })
    expect(replayed.receipt).not.toHaveProperty('replayed')
    const context = {
      target: { kernelIssuer: 'https://kernel.example' },
      credentialPrincipal: () => 'domain',
      session: { dispatch: async () => answer },
    } as unknown as ConnectionContext
    const shown = await human(() =>
      callCommand(
        '/:jobs.example:function.hold',
        ['invoice=inv-1'],
        {},
        {
          async runKernelCommand(input) {
            await input.format!(await input.fn(context), {}, false)
          },
          output: () => {},
        },
      ),
    )
    expect(shown.lines).toContain(
      'This call already ran as run-1: the receipt names its recorded Execution; nothing ran again.',
    )
  })

  test('keeps an id-shaped value a value', async () => {
    expect(await outcome({ kind: 'value', invocation, value: { id: 'run-1' } })).toEqual({
      kind: 'value',
      invocation,
      value: { id: 'run-1' },
    })
  })
})
