import { describe, expect, it } from 'bun:test'

import { idempotencyKey, randomOperationId } from '../idempotency'

describe('Kernel-compatible idempotency keys', () => {
  it('joins semantic coordinates with only URL-safe separators', () => {
    expect(idempotencyKey('identity-register', 'operator.test')).toBe(
      'identity-register.operator.test',
    )
  })

  it('generates a bounded URL-safe operation id', () => {
    const value = randomOperationId('cli', 'instance', 'delete')
    expect(value).toMatch(
      /^cli\.instance\.delete\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    )
    expect(value.length).toBeLessThanOrEqual(128)
  })

  it.each(['', 'contains:colon', 'contains space', 'a'.repeat(129)])(
    'rejects non-protocol key %j before invocation',
    (value) => {
      expect(() => idempotencyKey(value)).toThrow(
        'Idempotency key must contain 1-128 URL-safe ASCII characters.',
      )
    },
  )
})
