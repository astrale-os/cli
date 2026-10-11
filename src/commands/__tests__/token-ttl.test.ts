import type { AuthApi, Identity, IssuerId, MintedCredential } from '@astrale-os/sdk/auth'

import { describe, expect, mock, test } from 'bun:test'

import { AstraleError } from '../../errors'
import { issueToken, parseTtl, tokenCommand } from '../token'

describe('token lifetime', () => {
  test('defaults short, admits only a positive integer, and carries it into the credential intent', async () => {
    // Beneath the one-hour local operator proof.
    expect(parseTtl(undefined)).toBe(240)
    expect(parseTtl('90')).toBe(90)
    for (const ttl of ['abc', '0', '-5', '1.5']) expect(() => parseTtl(ttl)).toThrow(AstraleError)

    const runs: unknown[] = []
    await tokenCommand(
      { ttl: '90', raw: true },
      { runKernelCommand: (async (input: unknown) => void runs.push(input)) as never },
    )
    // A caller-principal carrier for the complete nested token lifetime.
    expect(runs).toMatchObject([{ credential: { principal: 'caller', nestedTtlSeconds: 90 } }])
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

  test('mints a top-level credential for the Kernel, delegates the identity for another audience', async () => {
    const mint = mock(async () => 'kernel-token' as MintedCredential)
    const delegate = mock(async () => 'delegated-token' as MintedCredential)
    const whoami = mock(async () => identity)
    const auth = { mint, delegate, whoami } satisfies Pick<AuthApi, 'delegate' | 'mint' | 'whoami'>

    expect(await issueToken(auth, kernel, kernel, 90)).toBe('kernel-token' as MintedCredential)
    expect(mint).toHaveBeenCalledWith({ ttlSeconds: 90 })
    expect(delegate).not.toHaveBeenCalled()

    const service = 'https://service.test' as IssuerId
    expect(await issueToken(auth, kernel, service, 120)).toBe('delegated-token' as MintedCredential)
    expect(mint).toHaveBeenCalledTimes(1)
    expect(delegate).toHaveBeenCalledWith(identity.id, { audience: service, ttlSeconds: 120 })
  })
})
