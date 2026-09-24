import { expect, test } from 'bun:test'

import { boundedValue, boundToolCall } from './tool-calls'

test('a long output keeps its head and says it was cut', () => {
  const kept = boundToolCall({
    title: 'Read big.ts',
    content: [
      { type: 'text', text: 'x'.repeat(100_000) },
      { type: 'diff', path: 'a.ts', oldText: 'before', newText: 'y'.repeat(100_000) },
      { type: 'text', text: 'short' },
    ],
    locations: [],
  })

  const [text, diff, short] = kept.content
  expect(text).toMatchObject({ type: 'text', truncated: true })
  expect(text?.type === 'text' && text.text.length).toBe(24_000)
  expect(diff).toMatchObject({ type: 'diff', path: 'a.ts', oldText: 'before', truncated: true })
  expect(short).toEqual({ type: 'text', text: 'short' })
})

test('a raw value stays JSON, bounded in length, depth and width', () => {
  const deep: Record<string, unknown> = {}
  let cursor = deep
  for (let depth = 0; depth < 20; depth += 1) cursor = cursor.next = {} as Record<string, unknown>

  const bounded = boundedValue({
    command: 'pnpm test',
    output: 'z'.repeat(20_000),
    deep,
    skipped: undefined,
  }) as Record<string, unknown>
  expect(bounded.command).toBe('pnpm test')
  expect(String(bounded.output)).toEndWith('… [12000 more characters]')
  expect(JSON.stringify(bounded.deep)).toContain('"…"')
  expect('skipped' in bounded).toBe(false)

  // once the budget is spent, what is left is counted rather than kept
  const wide = boundedValue({
    many: Array.from({ length: 1_000 }, (_, index) => index),
    after: 'never reached',
  }) as Record<string, unknown>
  const many = wide.many as unknown[]
  expect(many.length).toBeLessThan(1_000)
  expect(String(many.at(-1))).toMatch(/^… \[\d+ more\]$/)
  expect(wide.after).toBeUndefined()
  expect(wide['…']).toBe('… [1 more]')
})

test('a key named like a prototype stays a plain key', () => {
  const value = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}')
  const bounded = boundedValue(value) as Record<string, unknown>

  expect(Object.getPrototypeOf(bounded)).toBe(Object.prototype)
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  expect(Object.keys(bounded)).toEqual(['__proto__', 'ok'])
})
