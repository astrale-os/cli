import { describe, expect, test } from 'bun:test'

import { clampLog } from '../analyze'

describe('clampLog', () => {
  test('short output is written through untouched', () => {
    const json = '{"is_error":false,"num_turns":3}'
    expect(clampLog(json)).toBe(json)
  })

  test('output at exactly the limit is not clamped', () => {
    const text = 'x'.repeat(1000)
    expect(clampLog(text, 1000)).toBe(text)
  })

  test('oversized output keeps its head and its tail', () => {
    // The JSON envelope opens at the top; a stack or error message closes at
    // the bottom. Both must survive; the middle is what nobody reads.
    const text = `HEAD${'x'.repeat(50_000)}TAIL`
    const clamped = clampLog(text, 1000)
    expect(clamped.startsWith('HEAD')).toBe(true)
    expect(clamped.endsWith('TAIL')).toBe(true)
    expect(clamped).toContain('bytes elided')
  })

  test('the result stays within a small constant of the limit', () => {
    const clamped = clampLog('y'.repeat(10_000_000), 4096)
    // head + tail + the elision marker, never the input.
    expect(clamped.length).toBeLessThan(4096 + 128)
  })

  test('the elision count reports what was actually dropped', () => {
    const clamped = clampLog('z'.repeat(10_000), 1000)
    const elided = Number(/… (\d+) bytes elided …/u.exec(clamped)?.[1])
    const kept = clamped.length - `\n… ${elided} bytes elided …\n`.length
    expect(elided + kept).toBe(10_000)
  })
})
