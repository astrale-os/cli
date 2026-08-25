import { describe, expect, test } from 'bun:test'

import { materializeCallResult } from '../call'

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
