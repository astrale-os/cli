import { describe, expect, test } from 'bun:test'
import { SignJWT } from 'jose'
import { webcrypto } from 'node:crypto'

import { resolveSelfIdAuthenticated } from '../self'

describe('resolveSelfIdAuthenticated', () => {
  /** @evidence TEST-CLI-SELF-USES-AUTHENTICATED-EFFECTIVE-PRINCIPAL */
  test('uses child whoami for a manager-to-child Management carrier', async () => {
    const key = await generateEs256()
    const credential = await new SignJWT({ carrier: 'management' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer('https://manager.example')
      .setSubject('manager-principal')
      .setAudience('https://child.example')
      .sign(key)
    const opts = { creds: credential, url: 'https://manager.example/children/child/invoke' }

    const resolved = await resolveSelfIdAuthenticated(opts, {
      whoami: async (received) => {
        expect(received).toBe(opts)
        return { id: 'child-kernel-principal', slug: 'child' }
      },
    })

    expect(resolved).toEqual({ id: 'child-kernel-principal', slug: 'child' })
  })

  test('resolves an imported root without requiring a local registration', async () => {
    await expect(
      resolveSelfIdAuthenticated(
        { as: 'platform-root', url: 'https://manager.example/invoke' },
        { whoami: async () => ({ id: 'manager-kernel-principal' }) },
      ),
    ).resolves.toEqual({ id: 'manager-kernel-principal' })
  })

  test('fails closed when authenticated whoami returns no NodeId', async () => {
    await expect(
      resolveSelfIdAuthenticated({}, { whoami: async () => ({ id: '   ' }) }),
    ).rejects.toMatchObject({ name: 'SelfResolutionError' })
  })
})

async function generateEs256(): Promise<CryptoKey> {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  return pair.privateKey
}
