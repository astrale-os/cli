import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { spinner, withSpinner } from '../log'
import { log } from '../log'

describe('log diagnostics', () => {
  let stdout: string[]
  let stderr: string[]
  let originalLog: typeof console.log
  let originalError: typeof console.error

  beforeEach(() => {
    stdout = []
    stderr = []
    originalLog = console.log
    originalError = console.error
    console.log = mock((...values: unknown[]) => stdout.push(values.map(String).join(' ')))
    console.error = mock((...values: unknown[]) => stderr.push(values.map(String).join(' ')))
  })

  afterEach(() => {
    console.log = originalLog
    console.error = originalError
  })

  test('warnings use stderr so machine-readable stdout remains one value', () => {
    log.warn('identity override consented')

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('identity override consented')
  })
})

// The spinner shares stderr with the structured error line machine mode writes
// there, and it drives ora, which divides by the terminal width. Both make the
// stream's own shape part of the contract.
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

  test('a redirected stderr gets no animation and no stray line', () => {
    asStderr({ writable: true, isTTY: undefined, columns: undefined })
    expect(spinner('Fetching domains').isSpinning).toBe(false)
  })

  // `script` and some CI wrappers report a TTY with columns 0. ora guards the
  // width with `?? 80`, which a 0 walks through, then divides by it and clears
  // an Infinity line count — the command hangs instead of finishing.
  test('a zero-column terminal is refused rather than divided by', () => {
    asStderr({ writable: true, isTTY: true, columns: 0 })
    expect(spinner('Fetching domains').isSpinning).toBe(false)
  })

  test('the wrapped operation still runs and returns when no animation is shown', async () => {
    asStderr({ writable: true, isTTY: true, columns: 0 })
    expect(await withSpinner('Fetching domains', true, async () => 'result')).toBe('result')
  })
})
