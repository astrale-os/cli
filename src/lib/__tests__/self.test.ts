import { describe, expect, test } from 'bun:test'

import { containsSelfRef, expandSelfReferences } from '../self'

describe('containsSelfRef / expandSelfReferences', () => {
  const ID = 'node-abc-123'

  test.each([
    ['@self', `@${ID}`],
    ['@self::deployFunction', `@${ID}::deployFunction`],
    ['@self/functions', `@${ID}/functions`],
    ['@self/functions/foo', `@${ID}/functions/foo`],
    ['node=@self', `node=@${ID}`],
    ['target=@self::method', `target=@${ID}::method`],
    ['target=@self/sub', `target=@${ID}/sub`],
    ['x=@self::m  y=@self', `x=@${ID}::m  y=@${ID}`],
  ])('expands %p -> %p', (input, expected) => {
    expect(containsSelfRef(input)).toBe(true)
    expect(expandSelfReferences(input, ID)).toBe(expected)
  })

  test.each([
    ['@self', 'x$&y', '@x$&y'],
    ['@self', 'x$$y', '@x$$y'],
    ['@self', 'x$1y', '@x$1y'],
    ['@self', 'x$`y', '@x$`y'],
    ['@self::m', 'x$&y', '@x$&y::m'],
  ])('treats replacement metacharacters literally: %p x %p -> %p', (input, id, expected) => {
    expect(expandSelfReferences(input, id)).toBe(expected)
  })

  test.each([
    'prefix@self',
    '@selfsuffix',
    '@self.example',
    '@self,@other',
    'node=before@self',
    '{"ref":"@self"}',
    'no-self-here',
  ])('does not expand %p', (input) => {
    expect(containsSelfRef(input)).toBe(false)
    expect(expandSelfReferences(input, ID)).toBe(input)
  })

  test('is stateless across calls', () => {
    expect(containsSelfRef('@self')).toBe(true)
    expect(containsSelfRef('@self')).toBe(true)
    expect(containsSelfRef('@self')).toBe(true)
  })
})
