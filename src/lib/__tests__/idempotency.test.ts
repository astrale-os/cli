import { describe, expect, it } from 'bun:test'

import { derivedIdempotencyKey, idempotencyKey, randomOperationId } from '../idempotency'

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

  it('derives stable bounded keys without normalizing distinct caller material', async () => {
    const long = 'a'.repeat(256)
    const first = await derivedIdempotencyKey('identity-register', long)
    const replay = await derivedIdempotencyKey('identity-register', long)
    const colon = await derivedIdempotencyKey('e2e.assign-host', 'a:b')
    const hyphen = await derivedIdempotencyKey('e2e.assign-host', 'a-b')

    expect(first).toBe(replay)
    expect(first).toMatch(/^identity-register\.[a-f0-9]{64}$/u)
    expect(first.length).toBeLessThanOrEqual(128)
    expect(colon).not.toBe(hyphen)
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
