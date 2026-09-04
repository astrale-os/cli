import { describe, expect, test } from 'bun:test'
import { SignJWT } from 'jose'
import { webcrypto } from 'node:crypto'

import type { ConnectionContext } from '../session'

import { expandSelfInCall, resolveSelfIdAuthenticated } from '../self'

const context = Object.freeze({}) as ConnectionContext

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
    const resolved = await resolveSelfIdAuthenticated(context, {
      whoami: async (received) => {
        expect(received).toBe(context)
        return { id: 'child-kernel-principal', slug: 'child' }
      },
    })

    expect(resolved).toEqual({ id: 'child-kernel-principal', slug: 'child' })
  })

  test('resolves an imported root without requiring a local registration', async () => {
    await expect(
      resolveSelfIdAuthenticated(context, {
        whoami: async () => ({ id: 'manager-kernel-principal' }),
      }),
    ).resolves.toEqual({ id: 'manager-kernel-principal' })
  })

  test('fails closed when authenticated whoami returns no NodeId', async () => {
    await expect(
      resolveSelfIdAuthenticated(context, { whoami: async () => ({ id: '   ' }) }),
    ).rejects.toMatchObject({ code: 'SELF_RESOLUTION_FAILED' })
  })
})

describe('expandSelfInCall', () => {
  test('uses the selected caller for both receiver and parameters, not the exchanged Domain', async () => {
    let resolutions = 0
    const callContext = {
      auth: { whoami: async () => ({ id: 'shell-domain-id' }) },
      self: async () => {
        resolutions += 1
        return { id: 'caller-id' }
      },
      target: { slug: 'child' },
    } as ConnectionContext

    const expanded = await expandSelfInCall('@self::resolveHome', { owner: '@self' }, callContext)
    expect(expanded.path).toBe('@caller-id::resolveHome')
    expect(expanded.parameters).toEqual({ owner: '@caller-id' })
    expect(expanded.meta?.slug).toBe('child')
    expect(resolutions).toBe(1)

    await expandSelfInCall('@explicit-user::resolveHome', {}, callContext)
    expect(resolutions).toBe(1)
  })

  test('expands only top-level string values after local parameter admission', async () => {
    const callContext = {
      auth: { whoami: async () => ({ id: 'shell-domain-id' }) },
      self: async () => ({ id: 'caller-id' }),
      target: {},
    } as ConnectionContext
    const expanded = await expandSelfInCall(
      '/:people.example.dev:class.Person:get',
      { owner: '@self', count: 2, nested: { owner: '@self' } },
      callContext,
    )
    expect(expanded.parameters).toEqual({
      owner: '@caller-id',
      count: 2,
      nested: { owner: '@self' },
    })
  })
})

async function generateEs256(): Promise<CryptoKey> {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  return pair.privateKey
}
