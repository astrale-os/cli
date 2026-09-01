import type { AuthApi, Identity, IssuerId, MintedCredential } from '@astrale-os/sdk/auth'

import { describe, expect, mock, test } from 'bun:test'

import { AstraleError } from '../../errors'
import { issueToken, parseTtl } from '../token'

describe('parseTtl', () => {
  test('keeps ordinary tokens short beneath the one-hour local operator proof', () => {
    expect(parseTtl(undefined)).toBe(240)
  })

  test('rejects non-positive and non-integer values', () => {
    expect(() => parseTtl('abc')).toThrow(AstraleError)
    expect(() => parseTtl('0')).toThrow(AstraleError)
    expect(() => parseTtl('-5')).toThrow(AstraleError)
    expect(() => parseTtl('1.5')).toThrow(AstraleError)
  })

  test('admits a positive integer', () => {
    expect(parseTtl('90')).toBe(90)
  })
})

describe('issueToken', () => {
  const kernel = 'https://kernel.test' as IssuerId
  const identity = {
    id: 'caller' as Identity['id'],
    iss: 'https://issuer.test' as IssuerId,
    sub: 'caller',
    frozen: false,
    requiredClaims: [],
  } satisfies Identity

  test('mints a reusable top-level credential for the Kernel audience', async () => {
    const mint = mock(async () => 'kernel-token' as MintedCredential)
    const delegate = mock(async () => 'delegated-token' as MintedCredential)
    const whoami = mock(async () => identity)
    const auth = { mint, delegate, whoami } satisfies Pick<AuthApi, 'delegate' | 'mint' | 'whoami'>

    await expect(issueToken(auth, kernel, kernel, 90)).resolves.toBe(
      'kernel-token' as MintedCredential,
    )
    expect(mint).toHaveBeenCalledWith({ ttlSeconds: 90 })
    expect(whoami).not.toHaveBeenCalled()
    expect(delegate).not.toHaveBeenCalled()
  })

  test('delegates the selected identity only for an external audience', async () => {
    const mint = mock(async () => 'kernel-token' as MintedCredential)
    const delegate = mock(async () => 'delegated-token' as MintedCredential)
    const whoami = mock(async () => identity)
    const auth = { mint, delegate, whoami } satisfies Pick<AuthApi, 'delegate' | 'mint' | 'whoami'>

    await expect(issueToken(auth, kernel, 'https://service.test' as IssuerId, 120)).resolves.toBe(
      'delegated-token' as MintedCredential,
    )
    expect(mint).not.toHaveBeenCalled()
    expect(whoami).toHaveBeenCalledTimes(1)
    expect(delegate).toHaveBeenCalledWith(identity.id, {
      audience: 'https://service.test',
      ttlSeconds: 120,
      attenuation: { kind: 'identity', self: true },
    })
  })
})
