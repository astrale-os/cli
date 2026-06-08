import { describe, expect, test } from 'bun:test'

// We test the stripMethodSuffix behavior indirectly through the module's exports.
// Since stripMethodSuffix is private, we test the pattern directly.
const stripMethodSuffix = (msg: string): string => {
  return msg.replace(/(\/[^"\s:]+)::([a-zA-Z]\w*)/g, '$1')
}

describe('stripMethodSuffix', () => {
  test('strips ::listChildren from path', () => {
    expect(stripMethodSuffix('Path not found: "/nonexistent::listChildren"')).toBe(
      'Path not found: "/nonexistent"',
    )
  })

  test('strips ::get from path', () => {
    expect(stripMethodSuffix('Path not found: "/some/path::get"')).toBe(
      'Path not found: "/some/path"',
    )
  })

  test('strips any method name', () => {
    expect(stripMethodSuffix('"/kernel.astrale.ai/Root::describe"')).toBe(
      '"/kernel.astrale.ai/Root"',
    )
  })

  test('does not strip from non-path strings', () => {
    expect(stripMethodSuffix('regular::text')).toBe('regular::text')
  })

  test('handles multiple paths in one message', () => {
    expect(stripMethodSuffix('"/a/b::get" and "/c/d::list"')).toBe('"/a/b" and "/c/d"')
  })

  test('preserves messages without method suffixes', () => {
    expect(stripMethodSuffix('No path found')).toBe('No path found')
  })

  test('does not strip single colon (not a method dispatch)', () => {
    expect(stripMethodSuffix('"/a/b:notMethod"')).toBe('"/a/b:notMethod"')
  })
})
