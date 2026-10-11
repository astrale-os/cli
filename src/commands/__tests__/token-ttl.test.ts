import type { AuthApi, Identity, IssuerId, MintedCredential } from '@astrale-os/sdk/auth'

import { describe, expect, mock, spyOn, test } from 'bun:test'

import { AstraleError } from '../../errors'
import { unsignedJwt } from '../../lib/__tests__/idp.fixture'
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

  test('--json prints the token beside the expiry its own exp claim carries', async () => {
    const runs: Array<{ format: (token: string, opts: { json: boolean }) => void }> = []
    await tokenCommand(
      { json: true },
      { runKernelCommand: (async (input: never) => void runs.push(input)) as never },
    )
    const token = unsignedJwt({ exp: 1_893_456_000 })
    const written: string[] = []
    const write = spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
      written.push(chunk)
      return true
    }) as never)
    try {
      runs[0]!.format(token, { json: true })
    } finally {
      write.mockRestore()
    }
    expect(JSON.parse(written.join(''))).toEqual({ token, expiresAt: '2030-01-01T00:00:00.000Z' })
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
