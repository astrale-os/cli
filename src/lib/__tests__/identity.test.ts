import { describe, expect, test } from 'bun:test'

import { IdentityStoreSchema } from '../identity'

describe('IdentityStoreSchema', () => {
  test('parses valid store', () => {
    const result = IdentityStoreSchema.parse({
      default: 'manager',
      identities: {
        manager: { subject: 'manager', createdAt: '2024-01-01T00:00:00Z' },
      },
    })
    expect(result.default).toBe('manager')
    expect(result.identities.manager.subject).toBe('manager')
  })

  test('parses multiple identities', () => {
    const result = IdentityStoreSchema.parse({
      default: 'admin',
      identities: {
        admin: { subject: 'admin', createdAt: '2024-01-01T00:00:00Z' },
        user: { subject: 'user-principal', createdAt: '2024-06-15T12:00:00Z' },
      },
    })
    expect(Object.keys(result.identities)).toHaveLength(2)
    expect(result.identities.user.subject).toBe('user-principal')
  })

  test('rejects missing default field', () => {
    expect(() =>
      IdentityStoreSchema.parse({
        identities: { manager: { subject: 'manager', createdAt: '2024-01-01' } },
      }),
    ).toThrow()
  })

  test('rejects identity missing subject', () => {
    expect(() =>
      IdentityStoreSchema.parse({
        default: 'manager',
        identities: { manager: { createdAt: '2024-01-01' } },
      }),
    ).toThrow()
  })

  test('accepts empty identities record', () => {
    const result = IdentityStoreSchema.parse({
      default: 'nobody',
      identities: {},
    })
    expect(Object.keys(result.identities)).toHaveLength(0)
  })
})
