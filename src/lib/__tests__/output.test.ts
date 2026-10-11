import { describe, expect, spyOn, test } from 'bun:test'

import { denoise, isMachine, output, present, presentList } from '../terminal/output'

/** What `print` wrote to stdout. */
function written(print: () => void): string {
  const write = spyOn(process.stdout, 'write').mockImplementation(() => true)
  try {
    print()
    return write.mock.calls.map(([chunk]) => String(chunk)).join('')
  } finally {
    write.mockRestore()
  }
}

describe('machine output', () => {
  test('a void result is the JSON null, never a bare "undefined"', () => {
    expect(written(() => output(undefined, { raw: true }))).toBe('null\n')
    expect(written(() => output(undefined, { json: true }))).toBe('null\n')
    expect(written(() => output(undefined, { format: 'json' }))).not.toContain('undefined')
    expect(written(() => output({ a: 1 }, { raw: true }))).toBe('{\n  "a": 1\n}\n')
  })

  test('--raw prints a bare scalar for shell capture; --json quotes it', () => {
    expect(isMachine({ raw: true }) && isMachine({ json: true })).toBe(true)
    expect(written(() => present('alice', { raw: true }))).toBe('alice\n')
    expect(written(() => present('alice', { json: true }))).toBe('"alice"\n')
    // Nothing rawer to give for an object.
    expect(written(() => present({ a: 1 }, { raw: true }))).toBe('{\n  "a": 1\n}\n')
  })

  test('denoise strips schema, icon and code at any depth, qualified schema keys included', () => {
    expect(
      denoise({
        id: 'x',
        icon: '<svg/>',
        props: {
          schema: 'huge',
          code: 'c',
          'kernel.astrale.ai:class.Domain.property.schema': { huge: true },
          'kernel.astrale.ai:class.Domain.property.origin': 'kernel.astrale.ai',
        },
      }),
    ).toEqual({
      id: 'x',
      props: { 'kernel.astrale.ai:class.Domain.property.origin': 'kernel.astrale.ai' },
    })
  })

  test('a list prints its count, its paths, or its denoised raw items', () => {
    const items = [
      { name: 'a', path: '/a', props: { schema: 'big', keep: 1 } },
      { name: 'b', path: '/b' },
    ]
    const project = (list: typeof items) => ({
      columns: [{ key: 'name', header: 'NAME' }],
      rows: list.map(({ name }) => ({ name })),
      paths: list.map(({ path }) => path),
    })
    expect(written(() => presentList(items, { count: true }, project))).toBe('2\n')
    expect(written(() => presentList(items, { quiet: true }, project))).toBe('/a\n/b\n')
    expect(JSON.parse(written(() => presentList(items, { json: true }, project)))).toEqual([
      { name: 'a', path: '/a', props: { keep: 1 } },
      { name: 'b', path: '/b' },
    ])
  })
})
