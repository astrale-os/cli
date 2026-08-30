import { describe, expect, test } from 'bun:test'

import type { ConnectionContext } from '../../connection'

import { callCommand, materializeCallResult } from '../call'

describe('call command dry run', () => {
  test('admits ordinary calls without resolving a Kernel connection', async () => {
    let connections = 0
    let rendered: unknown
    let presentationOptions: unknown
    await callCommand(
      '/:shipment.example:function.dispatch',
      [],
      { dryRun: true, data: '{"reference":"SHIP-1"}', json: true },
      {
        async runKernelCommand() {
          connections += 1
        },
        output(value, options) {
          rendered = value
          presentationOptions = options
        },
      },
    )
    expect(connections).toBe(0)
    expect(plainCall(rendered)).toEqual({
      target: '/:shipment.example:function.dispatch',
      input: { reference: 'SHIP-1' },
    })
    expect(presentationOptions).toEqual({
      dryRun: true,
      data: '{"reference":"SHIP-1"}',
      json: true,
    })
  })

  test('keeps @self in --data verbatim without resolving a Kernel connection', async () => {
    let connections = 0
    let rendered: unknown
    await callCommand(
      '/:shipment.example:function.dispatch',
      [],
      { dryRun: true, data: '{"owner":"@self"}', json: true },
      {
        async runKernelCommand() {
          connections += 1
        },
        output(value) {
          rendered = value
        },
      },
    )
    expect(connections).toBe(0)
    expect(plainCall(rendered)).toEqual({
      target: '/:shipment.example:function.dispatch',
      input: { owner: '@self' },
    })
  })

  test('resolves @self in CLI key=value params without dispatching', async () => {
    let connections = 0
    let dispatches = 0
    let rendered: unknown
    let presentationOptions: unknown
    const context = {
      auth: {
        async whoami() {
          return { id: 'alice' }
        },
      },
      target: {},
      session: {
        async dispatch() {
          dispatches += 1
          throw new Error('dry run must not dispatch')
        },
      },
    } as unknown as ConnectionContext

    await callCommand(
      '/:shipment.example:function.dispatch',
      ['owner=@self'],
      { dryRun: true, json: true },
      {
        async runKernelCommand(input) {
          connections += 1
          const result = await input.fn(context)
          await input.format?.(result, input.opts, true)
        },
        output(value, options) {
          rendered = value
          presentationOptions = options
        },
      },
    )

    expect(connections).toBe(1)
    expect(dispatches).toBe(0)
    expect(plainCall(rendered)).toEqual({
      target: '/:shipment.example:function.dispatch',
      input: { owner: '@alice' },
    })
    expect(presentationOptions).toMatchObject({ dryRun: true, json: true })
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
