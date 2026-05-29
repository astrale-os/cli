import { describe, expect, test } from 'bun:test'

import { mintDelegationPathFromCredential } from '../remote-routing'

function unsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url').replace(/=+$/, '')
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`
}

describe('remote routing credential mint target', () => {
  test('mints delegation from the authenticated subject, not __system__', () => {
    const credential = unsignedJwt({ sub: '962c0167-da55-48fe-ab03-e9cd241c8d65' })

    expect(mintDelegationPathFromCredential(credential)).toBe(
      '@962c0167-da55-48fe-ab03-e9cd241c8d65::mintDelegationCredential',
    )
  })

  test('falls back to __system__ for opaque non-JWT credentials', () => {
    expect(mintDelegationPathFromCredential('not-a-jwt')).toBe(
      '@__system__::mintDelegationCredential',
    )
  })

  test('maps the legacy system subject to the __system__ graph node', () => {
    expect(mintDelegationPathFromCredential(unsignedJwt({ sub: 'system' }))).toBe(
      '@__system__::mintDelegationCredential',
    )
  })
})
