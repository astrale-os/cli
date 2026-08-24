import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { AstraleError } from '../../errors'
import { failInput, fatal } from '../log'

class ExitError extends Error {}

let stderr = ''
let exit: typeof process.exit
let write: typeof process.stderr.write

beforeEach(() => {
  stderr = ''
  exit = process.exit
  write = process.stderr.write
  process.exit = (() => {
    throw new ExitError()
  }) as typeof process.exit
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write
})

afterEach(() => {
  process.exit = exit
  process.stderr.write = write
})

describe('terminal error safety', () => {
  test('renders an empty aggregate as an honest non-blank unexpected failure', () => {
    expect(() => fatal(new AggregateError([], ''), { json: true })).toThrow(ExitError)
    expect(JSON.parse(stderr)).toEqual({
      error: 'UNEXPECTED_ERROR',
      message: 'The CLI encountered an unexpected internal failure.',
    })
  })

  test('retains unknown failure evidence only under explicit debug output', () => {
    const failure = new AggregateError([new Error('provider rejected organization scope')], '')

    expect(() => fatal(failure, { json: true, debug: true })).toThrow(ExitError)

    expect(stderr).toContain(
      '{"error":"UNEXPECTED_ERROR","message":"The CLI encountered an unexpected internal failure."}',
    )
    expect(stderr).toContain('aggregate: Error: provider rejected organization scope')
  })

  test('rejects blank admitted CLI diagnostics', () => {
    expect(() => new AstraleError('INVALID_INPUT', '  ')).toThrow(TypeError)
  })

  test('labels only expected admission failures as invalid input', () => {
    expect(() => failInput(new TypeError('Authored value is invalid.'), { json: true })).toThrow(
      ExitError,
    )
    expect(JSON.parse(stderr)).toMatchObject({ error: 'INVALID_INPUT' })

    stderr = ''
    expect(() => failInput(new AggregateError([], ''), { json: true })).toThrow(ExitError)
    expect(JSON.parse(stderr)).toMatchObject({ error: 'UNEXPECTED_ERROR' })
  })
})
