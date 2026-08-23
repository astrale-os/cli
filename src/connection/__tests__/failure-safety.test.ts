import { expect, test } from 'bun:test'

import { formatKernelError } from '../errors'
import { legacyTransportFailure, sessionFailure, transportFailure } from './failure-fixtures'

/** @evidence TEST-CLI-CONNECTION-FAILURE-SAFETY */
test('unknown and empty native failures never become ordinary diagnostics', async () => {
  for (const failure of [new Error('private provider detail'), new Error(''), { secret: true }]) {
    const output = await capture(() => formatKernelError(failure, true))
    expect(JSON.parse(output)).toEqual({
      error: 'UNEXPECTED_ERROR',
      message: 'The CLI encountered an unexpected internal failure.',
    })
    expect(output).not.toContain('private provider detail')
  }
})

test('Aggregate children are available only under explicit debug output', async () => {
  const failure = new AggregateError([new Error('first private'), new Error('second private')], '')
  const ordinary = await capture(() => formatKernelError(failure, true))
  expect(ordinary).not.toContain('first private')
  expect(ordinary).not.toContain('second private')

  const debug = await capture(() => formatKernelError(failure, true, '', true))
  expect(debug).toContain('aggregate: Error: first private')
  expect(debug).toContain('aggregate: Error: second private')
})

test('Session and acquisition failures remain typed without unsafe recovery advice', async () => {
  const session = await capture(() =>
    formatKernelError(sessionFailure('Session operation timed out.', 'timeout'), true),
  )
  expect(JSON.parse(session)).toEqual({ error: 'TIMEOUT', message: 'Session operation timed out.' })

  const acquisition = await capture(() =>
    formatKernelError(
      transportFailure('Publication failed.', 'unknown', {
        kind: 'acquisition',
        resource: 'publication',
      }),
      true,
      '',
      false,
      { recovery: { operation: 'must-not-leak', retry: 'must-not-leak' } },
    ),
  )
  expect(JSON.parse(acquisition)).toMatchObject({
    error: 'TRANSPORT_ERROR',
    transport: { kind: 'acquisition', resource: 'publication' },
  })
  expect(acquisition).not.toContain('must-not-leak')

  const legacy = await capture(() =>
    formatKernelError(legacyTransportFailure('Legacy send failed.', 'send', 'not-sent'), true),
  )
  expect(JSON.parse(legacy)).toMatchObject({
    error: 'TRANSPORT_ERROR',
    transport: { kind: 'invocation', delivery: 'not-sent' },
  })
})

async function capture(action: () => Promise<void>): Promise<string> {
  const writes: string[] = []
  const original = process.stderr.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    await action()
    return writes.join('')
  } finally {
    process.stderr.write = original
  }
}
