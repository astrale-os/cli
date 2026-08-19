import type { SessionAuth } from '@astrale-os/kernel-client/session'

import { issuer, type IssuerId } from '@astrale-os/sdk/auth'
import { Path } from '@astrale-os/sdk/graph/path'
import { describe, expect, test } from 'bun:test'

import type { AstraleConfig } from '../../lib/config'

import { createCliCredential, createConnectionCredential } from '../credential'

const SOURCE = issuer.accept('https://kernel.example')
const TARGET_CALL = Object.freeze({
  target: Path.parse('/:example.dev:function.call').raw,
  input: { value: 1 },
}) satisfies Parameters<SessionAuth['resolve']>[0]
const config: AstraleConfig = {
  issuer: 'https://cli.example',
  admin: { name: 'admin', url: SOURCE, kernelIssuer: SOURCE },
  telemetry: { enabled: false },
}

describe('connection credential', () => {
  /** @evidence TEST-CLI-CONNECTION-RESOLVES-SOURCE-AUTH-BEFORE-ROUTING */
  test('resolves source authority without destination knowledge', async () => {
    const audiences: IssuerId[] = []
    const calls: unknown[] = []
    const auth = createConnectionCredential(SOURCE, {
      async resolve(audience) {
        audiences.push(audience)
        return `source:${audience}`
      },
    })
    const signal = new AbortController().signal

    calls.push(TARGET_CALL)
    await expect(auth.resolve(TARGET_CALL, signal)).resolves.toEqual({
      credential: `source:${SOURCE}`,
    })

    expect(auth.ttlSeconds).toBe(60)
    expect(audiences).toEqual([SOURCE])
    expect(calls).toEqual([TARGET_CALL])
  })

  /** @evidence TEST-CLI-CONNECTION-BOUNDS-REMOTE-CARRIER-TO-SOURCE-LIFETIME */
  test('bounds destination delegation to the current source credential lifetime', async () => {
    const expiresAt = Math.ceil(Date.now() / 1_000) + 120
    const auth = createConnectionCredential(SOURCE, {
      async resolve() {
        return token(expiresAt)
      },
    })

    const resolved = await auth.resolve(TARGET_CALL, new AbortController().signal)
    expect(resolved.credential).toBe(token(expiresAt))
    expect(resolved.delegate?.ttlSeconds).toBeGreaterThan(0)
    expect(resolved.delegate?.ttlSeconds).toBeLessThan(120)
  })

  /** @evidence TEST-CLI-CONNECTION-USES-RAW-SOURCE-CREDENTIAL */
  test('binds explicit CLI credentials to source-Kernel auth only', async () => {
    const auth = createCliCredential(
      { url: `${SOURCE}/invoke`, kernelIssuer: SOURCE, slug: 'source' },
      { creds: 'raw-source-token' },
      config,
    )
    if (auth === undefined) throw new Error('expected authenticated credential')

    await expect(auth.resolve(TARGET_CALL, new AbortController().signal)).resolves.toEqual({
      credential: 'raw-source-token',
    })
  })

  /** @evidence TEST-CLI-CONNECTION-OMITS-EXPLICIT-ANONYMOUS-CREDENTIAL */
  test('omits the auth capability for an explicit anonymous session', () => {
    const auth = createCliCredential(
      { url: `${SOURCE}/invoke`, kernelIssuer: SOURCE, defaultIdentity: 'ambient-default' },
      { anonymous: true },
      config,
    )

    expect(auth).toBeUndefined()
  })

  /** @evidence TEST-CLI-CONNECTION-PROPAGATES-AUTH-CANCELLATION */
  test('passes the live Session operation signal to source credential resolution', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    const auth = createConnectionCredential(SOURCE, {
      async resolve(_audience, signal) {
        expect(signal).toBe(controller.signal)
        throw signal.reason
      },
    })
    controller.abort(reason)

    await expect(auth.resolve(TARGET_CALL, controller.signal)).rejects.toBe(reason)
  })
})

function token(exp: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: SOURCE,
    sub: 'principal',
    aud: SOURCE,
    exp,
  })}.signature`
}
