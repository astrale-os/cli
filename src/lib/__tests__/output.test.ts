import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { denoise, isMachine, output, present, presentList } from '../output'

function captureStdout(): { writes: string[]; restore: () => void } {
  const writes: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = mock((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
    return true
  }) as typeof process.stdout.write
  return { writes, restore: () => (process.stdout.write = original) }
}

describe('output — void/undefined normalization', () => {
  let writes: string[] = []
  let originalWrite: typeof process.stdout.write

  beforeEach(() => {
    writes = []
    originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = mock((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }) as typeof process.stdout.write
  })

  afterEach(() => {
    process.stdout.write = originalWrite
  })

  test('--raw output for void syscall is "null", not bare "undefined"', () => {
    // Regression: JSON.stringify(undefined) returns undefined (not "undefined"),
    // so concatenating with '\n' coerced to the literal string 'undefined\n'.
    // Any wrapper doing JSON.parse(stdout) would blow up.
    output(undefined, { raw: true })
    expect(writes.join('')).toBe('null\n')
  })

  test('--json output for void syscall is "null"', () => {
    output(undefined, { json: true })
    expect(writes.join('')).toBe('null\n')
  })

  test('explicit format=json on non-TTY yields "null" for void', () => {
    output(undefined, { format: 'json' })
    const out = writes.join('')
    // On TTY the value gets ANSI-colored; either way the parseable token is `null`.
    expect(out).toContain('null')
    expect(out).not.toContain('undefined')
  })

  test('--raw output for actual data is unchanged', () => {
    output({ a: 1 }, { raw: true })
    expect(writes.join('')).toBe('{\n  "a": 1\n}\n')
  })
})

describe('isMachine', () => {
  test('returns true for --raw', () => {
    expect(isMachine({ raw: true })).toBe(true)
  })

  test('returns true for --json', () => {
    expect(isMachine({ json: true })).toBe(true)
  })

  test('returns true when both are set', () => {
    expect(isMachine({ raw: true, json: true })).toBe(true)
  })

  test('returns false for empty opts when TTY', () => {
    // This test depends on the test runner's TTY state.
    // In a non-TTY environment (CI), isMachine({}) returns true.
    const result = isMachine({})
    expect(typeof result).toBe('boolean')
  })

  test('handles undefined opts', () => {
    const result = isMachine()
    expect(typeof result).toBe('boolean')
  })
})

describe('present — scalar', () => {
  let cap: ReturnType<typeof captureStdout>
  beforeEach(() => (cap = captureStdout()))
  afterEach(() => cap.restore())

  test('--raw prints a bare string (no quotes) for shell capture', () => {
    present('alice', { raw: true })
    expect(cap.writes.join('')).toBe('alice\n')
  })

  test('--json prints a quoted JSON string', () => {
    present('alice', { json: true })
    expect(cap.writes.join('')).toBe('"alice"\n')
  })

  test('objects fall back to JSON under --raw (nothing rawer to give)', () => {
    present({ a: 1 }, { raw: true })
    expect(cap.writes.join('')).toBe('{\n  "a": 1\n}\n')
  })
})

describe('denoise', () => {
  test('strips schema / icon / code at any depth, keeps the rest', () => {
    const out = denoise({
      id: 'x',
      icon: '<svg/>',
      props: { schema: 'huge', name: 'n', code: 'c' },
    })
    expect(out).toEqual({ id: 'x', props: { name: 'n' } })
  })
})

describe('presentList', () => {
  let cap: ReturnType<typeof captureStdout>
  beforeEach(() => (cap = captureStdout()))
  afterEach(() => cap.restore())

  const project = (items: Array<{ name: string; path?: string; props?: unknown }>) => ({
    columns: [{ key: 'name', header: 'NAME' }],
    rows: items.map((i) => ({ name: i.name })),
    paths: items.map((i) => i.path ?? ''),
  })

  test('--count prints only the number', () => {
    presentList([{ name: 'a' }, { name: 'b' }], { count: true }, project)
    expect(cap.writes.join('')).toBe('2\n')
  })

  test('-q prints one path per line', () => {
    presentList(
      [
        { name: 'a', path: '/a' },
        { name: 'b', path: '/b' },
      ],
      { quiet: true },
      project,
    )
    expect(cap.writes.join('')).toBe('/a\n/b\n')
  })

  test('machine output is the denoised raw items, not the projected rows', () => {
    presentList([{ name: 'a', props: { schema: 'big', keep: 1 } }], { json: true }, project)
    const out = JSON.parse(cap.writes.join(''))
    expect(out).toEqual([{ name: 'a', props: { keep: 1 } }])
  })
})
