import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import { AstraleError } from '../../errors'
import { failInput, fatal, log, spinner, withSpinner } from '../terminal/log'

describe('diagnostics', () => {
  test('warnings use stderr so machine-readable stdout remains one value', () => {
    const out = spyOn(console, 'log').mockImplementation(() => undefined)
    const err = spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      log.warn('identity override consented')
      expect(out).not.toHaveBeenCalled()
      expect(String(err.mock.calls.flat())).toContain('identity override consented')
    } finally {
      out.mockRestore()
      err.mockRestore()
    }
  })

  /** What a terminal failure wrote to stderr before exiting. */
  function failure(fail: () => never): string {
    let written = ''
    const write = spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written += String(chunk)
      return true
    })
    const exit = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exited')
    })
    try {
      expect(fail).toThrow('exited')
      return written
    } finally {
      write.mockRestore()
      exit.mockRestore()
    }
  }

  test('an unknown failure is an honest unexpected one; its evidence shows only under debug', () => {
    const unexpected = {
      error: 'UNEXPECTED_ERROR',
      message: 'The CLI encountered an unexpected internal failure.',
    }
    expect(JSON.parse(failure(() => fatal(new AggregateError([], ''), { json: true })))).toEqual(
      unexpected,
    )
    const cause = new AggregateError([new Error('provider rejected organization scope')], '')
    const debug = failure(() => fatal(cause, { json: true, debug: true }))
    expect(debug).toContain(JSON.stringify(unexpected))
    expect(debug).toContain('aggregate: Error: provider rejected organization scope')
    expect(() => new AstraleError('INVALID_INPUT', '  ')).toThrow(TypeError)
  })

  test('only an expected admission failure is labelled invalid input', () => {
    const invalid = failure(() =>
      failInput(new TypeError('Authored value is invalid.'), { json: true }),
    )
    expect(JSON.parse(invalid)).toMatchObject({ error: 'INVALID_INPUT' })
    const unexpected = failure(() => failInput(new AggregateError([], ''), { json: true }))
    expect(JSON.parse(unexpected)).toMatchObject({ error: 'UNEXPECTED_ERROR' })
  })
})

// The spinner shares stderr with the structured error line machine mode writes there, and it
// drives ora, which divides by the terminal width: the stream's own shape is part of the contract.
describe('spinner admission', () => {
  const original = Object.getOwnPropertyDescriptor(process, 'stderr')
  const asStderr = (patch: Record<string, unknown>) =>
    Object.defineProperty(process, 'stderr', {
      configurable: true,
      value: { ...process.stderr, write: () => true, ...patch },
    })

  afterEach(() => {
    if (original) Object.defineProperty(process, 'stderr', original)
  })

  test('a redirected stderr or a zero-column terminal gets no animation, and the work still runs', async () => {
    asStderr({ writable: true, isTTY: undefined, columns: undefined })
    expect(spinner('Fetching domains').isSpinning).toBe(false)
    // `script` and some CI wrappers report a TTY with columns 0: ora would divide by it and hang.
    asStderr({ writable: true, isTTY: true, columns: 0 })
    expect(spinner('Fetching domains').isSpinning).toBe(false)
    expect(await withSpinner('Fetching domains', true, async () => 'result')).toBe('result')
  })
})
