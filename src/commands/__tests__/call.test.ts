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
})
