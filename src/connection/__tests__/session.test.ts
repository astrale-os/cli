import type { SessionRouteStore } from '@astrale-os/sdk/client/session'

import { issuer } from '@astrale-os/sdk/auth'
import { describe, expect, test } from 'bun:test'

import type { AstraleConfig } from '../../lib/config'
import type { ConnectionContext, ConnectionFactory } from '../session'

import { createClientSessionOptions, withResolvedClientSession } from '../session'

const target = Object.freeze({
  url: 'https://gateway.example/instances/child/invoke',
  kernelIssuer: issuer.accept('https://child.example'),
})
const config = {} as AstraleConfig
const context = Object.freeze({ target }) as unknown as ConnectionContext

/** A connection factory that must never be reached. */
const unopened: ConnectionFactory = () => {
  throw new Error('must not open')
}

describe('connection session', () => {
  /** @evidence TEST-CLI-CONNECTION-PINS-SOURCE-ISSUER */
  test('pins the Kernel issuer apart from the URL, and an anonymous session has no auth', () => {
    const routeStore: SessionRouteStore = { read: () => undefined, write: () => undefined }
    const auth = { ttlSeconds: 60, resolve: async () => ({ credential: 'credential' }) }
    const options = createClientSessionOptions(target, globalThis.fetch, auth, 2_500, routeStore)
    expect(options).toMatchObject({ kernel: target.kernelIssuer, auth, routeStore })
    expect(options).not.toHaveProperty('url')
    expect(
      Object.hasOwn(createClientSessionOptions(target, globalThis.fetch, undefined, 2_500), 'auth'),
    ).toBe(false)
  })

  /** @evidence TEST-CLI-CONNECTION-CLOSES-OWNED-CLIENTS */
  test('closes its owned connection once after success or failure', async () => {
    for (const fails of [false, true]) {
      let closes = 0
      const pending = withResolvedClientSession(
        target,
        {},
        config,
        async () => {
          if (fails) throw new DOMException('cancelled', 'AbortError')
          return 'done'
        },
        () => ({ context, close: () => void (closes += 1) }),
      )
      if (fails) await expect(pending).rejects.toThrow()
      else await expect(pending).resolves.toBe('done')
      expect(closes).toBe(1)
    }
  })

  /** @evidence TEST-CLI-CONNECTION-REJECTS-INVALID-TIMEOUT-BEFORE-OPEN */
  /** @evidence TEST-CLI-CONNECTION-REJECTS-ANONYMOUS-CREDENTIAL-CONFLICT */
  test('rejects invalid timeouts and contradictory credentials before opening', async () => {
    for (const options of [
      { timeout: '0' },
      { timeout: '1.5' },
      { timeout: '999999999999999999999' },
      { anonymous: true, as: 'alice' },
      { anonymous: true, creds: 'token' },
      { as: 'alice', creds: 'token' },
    ]) {
      await expect(
        withResolvedClientSession(target, options, config, async () => undefined, unopened),
      ).rejects.toMatchObject({ code: 'INVALID_FLAG' })
    }

    let opened: unknown
    await withResolvedClientSession(
      target,
      { timeout: '2500' },
      config,
      async () => undefined,
      (_target, timeoutMs, _options, _config, credential) => {
        opened = { timeoutMs, credential }
        return { context, close() {} }
      },
      { principal: 'caller', nestedTtlSeconds: 240 },
    )
    expect(opened).toEqual({
      timeoutMs: 2_500,
      credential: { principal: 'caller', nestedTtlSeconds: 240 },
    })
  })
})
