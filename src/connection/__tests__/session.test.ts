import type { AuthApi } from '@astrale-os/kernel-client/auth'
import type { GraphApi } from '@astrale-os/kernel-client/graph'
import type { HostSession } from '@astrale-os/kernel-client/host'

import { issuer } from '@astrale-os/kernel-core/auth'
import { describe, expect, test } from 'bun:test'

import type { AstraleConfig } from '../../lib/config'
import type { ConnectionContext, ConnectionFactory } from '../session'

import { createHostSessionOptions, withResolvedHostSession } from '../session'

const target = Object.freeze({
  url: 'https://gateway.example/instances/child/invoke',
  issuer: issuer.accept('https://child.example'),
})

const config: AstraleConfig = {
  issuer: 'https://cli.example',
  admin: { name: 'admin', url: 'https://admin.example', issuer: 'https://admin.example' },
  telemetry: { enabled: false },
}

const context: ConnectionContext = Object.freeze({
  host: {} as HostSession,
  graph: {} as GraphApi,
  auth: {} as AuthApi,
  target,
})

describe('connection session', () => {
  /** @evidence TEST-CLI-CONNECTION-PINS-SOURCE-ISSUER */
  test('pins the selected target issuer independently from its invocation URL', async () => {
    const auth = { ttlSeconds: 3_600, resolve: async () => ({ credential: 'credential' }) }
    const options = createHostSessionOptions(target, globalThis.fetch, auth, 2_500)

    expect(options.url).toBe('https://gateway.example/instances/child/invoke')
    expect(options.sourceIssuer).toBe(target.issuer)
  })

  /** @evidence TEST-CLI-CONNECTION-OMITS-EXPLICIT-ANONYMOUS-CREDENTIAL */
  test('constructs an anonymous Host session without an auth resolver', () => {
    const options = createHostSessionOptions(target, globalThis.fetch, undefined, 2_500)

    expect(options.sourceIssuer).toBe(target.issuer)
    expect(options.auth).toBeUndefined()
    expect(Object.hasOwn(options, 'auth')).toBe(false)
  })

  /** @evidence TEST-CLI-CONNECTION-CLOSES-OWNED-CLIENTS */
  test('closes its owned connection after success, failure, and cancellation', async () => {
    for (const outcome of ['success', 'failure', 'cancellation'] as const) {
      let closes = 0
      const open: ConnectionFactory = () => ({
        context,
        close() {
          closes += 1
        },
      })
      const pending = withResolvedHostSession(
        target,
        {},
        config,
        async (received) => {
          expect(received).toBe(context)
          if (outcome === 'failure') throw new Error('action failed')
          if (outcome === 'cancellation') throw new DOMException('cancelled', 'AbortError')
          return 'done'
        },
        open,
      )
      if (outcome === 'success') await expect(pending).resolves.toBe('done')
      else await expect(pending).rejects.toThrow()
      expect(closes).toBe(1)
    }
  })

  /** @evidence TEST-CLI-CONNECTION-REJECTS-INVALID-TIMEOUT-BEFORE-OPEN */
  test('rejects invalid timeouts before constructing a connection', async () => {
    for (const timeout of ['0', '-1', '1.5', 'nope', '999999999999999999999']) {
      let opened = false
      await expect(
        withResolvedHostSession(
          target,
          { timeout },
          config,
          async () => undefined,
          () => {
            opened = true
            throw new Error('must not open')
          },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_FLAG' })
      expect(opened).toBe(false)
    }

    let receivedTimeout = 0
    await withResolvedHostSession(
      target,
      { timeout: '2500' },
      config,
      async () => undefined,
      (_target, timeoutMs) => {
        receivedTimeout = timeoutMs
        return { context, close() {} }
      },
    )
    expect(receivedTimeout).toBe(2_500)
  })

  /** @evidence TEST-CLI-CONNECTION-REJECTS-ANONYMOUS-CREDENTIAL-CONFLICT */
  test('rejects anonymous plus explicit credentials before opening a connection', async () => {
    for (const options of [
      { anonymous: true, as: 'alice' },
      { anonymous: true, creds: 'token' },
      { anonymous: true, as: 'alice', creds: 'token' },
    ]) {
      let opened = false
      await expect(
        withResolvedHostSession(
          target,
          options,
          config,
          async () => undefined,
          () => {
            opened = true
            throw new Error('must not open')
          },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_FLAG' })
      expect(opened).toBe(false)
    }
  })
})
