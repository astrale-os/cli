import type { AuthApi } from '@astrale-os/sdk/auth'

import { describe, expect, mock, test } from 'bun:test'
import { once } from 'node:events'

import type { withClientSession } from '../../connection'
import type { ViewServeConfig } from '../view/session'

import { findFreePort } from '../port'
import { mintViewCredential, startViewServer } from '../view/server'

const digest = (character: string) => `sha256:${character.repeat(64)}` as const
const target = (value: string) => value as ViewServeConfig['session']['view']['target']
const issuer = (value: string) => value as ViewServeConfig['session']['view']['route']['issuer']
const revision = (character: string) =>
  digest(character) as ViewServeConfig['session']['view']['route']['revision']

describe('view session server credentials', () => {
  test('mints a proof-bounded credential for the Kernel audience', async () => {
    const mint = mock(async () => 'minted-credential')
    const auth = { mint } as unknown as Pick<AuthApi, 'mint'>

    await expect(mintViewCredential(auth, issuer('https://kernel.test'))).resolves.toBe(
      'minted-credential',
    )
    expect(mint).toHaveBeenCalledWith({
      audience: 'https://kernel.test',
      ttlSeconds: 240,
    })
  })

  /** @evidence TEST-CLI-SHELL-VIEW-MINTS-CALLER-CREDENTIAL */
  test('serves a caller-principal credential to a handshake-shell View', async () => {
    const nonce = 'shell-view'
    const port = await findFreePort(48_000, 200)
    if (port === null) throw new Error('test port window exhausted')
    const mint = mock(async () => 'minted-credential')
    const connect: typeof withClientSession = async (_options, action, intent) => {
      expect(intent).toEqual({ principal: 'caller', nestedTtlSeconds: 240 })
      return action({
        auth: { mint },
        target: { kernelIssuer: issuer('https://kernel.test') },
      } as never)
    }
    const config = {
      session: {
        id: 'v-shell',
        pid: 0,
        port,
        nonce,
        pageUrl: `http://127.0.0.1:${port}/`,
        view: {
          target: target('/:example.test'),
          route: {
            key: 'example.test:view.private',
            declaration: { target: { kind: 'domain' } },
            href: 'https://example.test/ui/private',
            handshake: 'shell',
            issuer: issuer('https://example.test'),
            etag: digest('c'),
            revision: revision('d'),
          },
        },
        createdAt: '2026-08-20T00:00:00.000Z',
      },
      kernel: { instance: 'managed', as: 'dispatcher' },
      proxy: {
        kernelUrl: 'https://kernel.test',
        issuer: 'https://kernel.test',
        direct: true,
      },
      transport: {
        href: 'https://example.test/ui/private',
        issuer: issuer('https://example.test'),
        etag: digest('c'),
        revision: revision('d'),
      },
      externalOrigins: [],
      idleMs: 60_000,
    } satisfies ViewServeConfig
    const server = startViewServer(config, { connect })
    await once(server, 'listening')

    try {
      const response = await fetch(`http://127.0.0.1:${port}/s/${nonce}/token`, {
        method: 'POST',
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ token: 'minted-credential', kind: 'minted' })
      expect(mint).toHaveBeenCalledWith({
        audience: 'https://kernel.test',
        ttlSeconds: 240,
      })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  /** @evidence TEST-CLI-PLAIN-VIEW-RECEIVES-NO-CREDENTIAL */
  test('refuses to mint a token for a handshake-none View', async () => {
    const nonce = 'plain-view'
    const port = await findFreePort(48_000, 200)
    if (port === null) throw new Error('test port window exhausted')
    const config = {
      session: {
        id: 'v-plain',
        pid: 0,
        port,
        nonce,
        pageUrl: `http://127.0.0.1:${port}/`,
        view: {
          target: target('/:example.test'),
          route: {
            key: 'example.test:view.public',
            declaration: { target: { kind: 'domain' } },
            href: 'https://example.test/ui/public',
            handshake: 'none',
            issuer: issuer('https://example.test'),
            etag: digest('a'),
            revision: revision('b'),
          },
        },
        createdAt: '2026-08-20T00:00:00.000Z',
      },
      kernel: { creds: 'must-not-be-used' },
      proxy: {
        kernelUrl: 'https://kernel.test',
        issuer: 'https://kernel.test',
        direct: true,
      },
      transport: {
        href: 'http://127.0.0.1:8787/ui/public',
        issuer: issuer('https://example.test'),
        etag: digest('a'),
        revision: revision('b'),
      },
      externalOrigins: ['https://connect.nango.dev'],
      idleMs: 60_000,
    } satisfies ViewServeConfig
    const server = startViewServer(config)
    await once(server, 'listening')

    try {
      const configResponse = await fetch(`http://127.0.0.1:${port}/s/${nonce}/config.json`)
      expect(configResponse.status).toBe(200)
      expect(await configResponse.json()).toMatchObject({
        sessionId: 'v-plain',
        externalOrigins: ['https://connect.nango.dev'],
        transport: {
          href: 'http://127.0.0.1:8787/ui/public',
          issuer: 'https://example.test',
          etag: digest('a'),
          revision: revision('b'),
        },
      })

      const response = await fetch(`http://127.0.0.1:${port}/s/${nonce}/token`, {
        method: 'POST',
      })

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: 'plain views have no Astrale credential privilege',
      })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
