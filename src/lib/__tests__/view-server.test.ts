import type { AuthApi } from '@astrale-os/sdk/auth'
import type { Server } from 'node:http'

import { describe, expect, mock, test } from 'bun:test'
import { once } from 'node:events'

import type { withClientSession } from '../../connection'
import type { ViewServeConfig } from '../view/session'

import { mintViewCredential, startViewServer, VIEW_DELEGATION_TTL_SECONDS } from '../view/server'
import { mintedCredential } from './view-credential.fixture'

const digest = (character: string) => `sha256:${character.repeat(64)}` as const
const target = (value: string) => value as ViewServeConfig['session']['view']['target']
const issuer = (value: string) => value as ViewServeConfig['session']['view']['route']['issuer']
const revision = (character: string) =>
  digest(character) as ViewServeConfig['session']['view']['route']['revision']

function address(server: Server): string {
  const value = server.address()
  if (value === null || typeof value === 'string') throw new Error('Missing HTTP address')
  return `http://127.0.0.1:${value.port}`
}

describe('view session server credentials', () => {
  test('mints a proof-bounded credential for the Kernel audience', async () => {
    const mint = mock(async () => mintedCredential('minted'))
    const auth = { mint } as unknown as Pick<AuthApi, 'mint'>

    await expect(mintViewCredential(auth, issuer('https://kernel.test'))).resolves.toBe(
      mintedCredential('minted'),
    )
    expect(mint).toHaveBeenCalledWith({
      audience: 'https://kernel.test',
      ttlSeconds: 240,
    })
  })

  test.each([
    { managed: true, external: true, explicit: false },
    { managed: false, external: true, explicit: false },
    { managed: true, external: false, explicit: false },
    { managed: true, external: true, explicit: true },
  ])('binds credentials to the mounted View (%j)', async ({ managed, external, explicit }) => {
    const nonce = 'shell-view'
    const mint = mock(async () => mintedCredential('minted'))
    const exchange = mock(async () => ({
      token: 'exchanged-credential',
      expiresAt: Date.now() + 240_000,
    }))
    const connect: typeof withClientSession = async (_options, action, intent) => {
      expect(intent).toEqual({ principal: 'caller', nestedTtlSeconds: 240 })
      return action({
        auth: { mint },
        target: {
          kernelIssuer: issuer('https://kernel.test'),
          ...(managed ? { domainIssuer: issuer('https://shell.test') } : {}),
        },
      } as never)
    }
    const config = {
      session: {
        id: 'v-shell',
        pid: 0,
        // Let the OS isolate each server from connections pooled by earlier tests.
        port: 0,
        nonce,
        pageUrl: '',
        view: {
          target: target('/:example.test'),
          route: {
            key: 'example.test:view.private',
            declaration: { target: { kind: 'domain' } },
            href: 'https://example.test/ui/private',
            handshake: 'shell',
            issuer: issuer(external ? 'https://example.test' : 'https://kernel.test'),
            etag: digest('c'),
            revision: revision('d'),
          },
        },
        createdAt: '2026-08-20T00:00:00.000Z',
      },
      kernel: {
        instance: 'managed',
        ...(explicit ? { creds: 'explicit-caller-proof' } : { as: 'dispatcher' }),
      },
      proxy: {
        kernelUrl: 'https://kernel.test',
        issuer: 'https://kernel.test',
        direct: true,
      },
      externalOrigins: [],
      idleMs: 60_000,
    } satisfies ViewServeConfig
    const server = startViewServer(config, { connect, exchange })
    await once(server, 'listening')

    try {
      const response = await fetch(`${address(server)}/s/${nonce}/token`, {
        method: 'POST',
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject(
        external && !explicit
          ? { token: 'exchanged-credential', kind: 'exchanged' }
          : { token: mintedCredential('minted'), kind: 'minted' },
      )
      if (external && !explicit) {
        expect(mint).not.toHaveBeenCalled()
        expect(exchange).toHaveBeenCalledWith(config.kernel, {
          kernelIssuer: 'https://kernel.test',
          domainIssuer: 'https://example.test',
        })
      } else {
        expect(exchange).not.toHaveBeenCalled()
        expect(mint).toHaveBeenCalledWith({ audience: 'https://kernel.test', ttlSeconds: 240 })
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  test('serves concurrent page requests from one mint, then reuses the grant', async () => {
    const nonce = 'shared-view'
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const mint = mock(async () => {
      await held
      return mintedCredential('minted')
    })
    const connections = mock(() => undefined)
    const connect: typeof withClientSession = async (_options, action) => {
      connections()
      return action({
        auth: { mint },
        target: { kernelIssuer: issuer('https://kernel.test') },
      } as never)
    }
    const config = {
      session: {
        id: 'v-shared',
        pid: 0,
        port: 0,
        nonce,
        pageUrl: '',
        view: {
          target: target('/:example.test'),
          route: {
            key: 'example.test:view.private',
            declaration: { target: { kind: 'domain' } },
            href: 'https://example.test/ui/private',
            handshake: 'shell',
            issuer: issuer('https://kernel.test'),
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
      externalOrigins: [],
      idleMs: 60_000,
    } satisfies ViewServeConfig
    const server = startViewServer(config, { connect })
    await once(server, 'listening')

    try {
      const token = () => fetch(`${address(server)}/s/${nonce}/token`, { method: 'POST' })
      const pending = [token(), token(), token()]
      release()
      const bodies = await Promise.all((await Promise.all(pending)).map((one) => one.json()))

      expect(bodies.map((body) => body.token)).toEqual([
        mintedCredential('minted'),
        mintedCredential('minted'),
        mintedCredential('minted'),
      ])
      expect(connections).toHaveBeenCalledTimes(1)

      // The grant still covers the View delegation, so a later request mints nothing.
      await token()
      expect(connections).toHaveBeenCalledTimes(1)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  test('serves the minted credential own expiration rather than the requested lifetime', async () => {
    const nonce = 'expiry-view'
    // Deliberately shorter than the requested 240 seconds: the issuer decides, not the request.
    const expiresAtSeconds = Math.floor(Date.now() / 1_000) + 180
    const mint = mock(async () => mintedCredential('short-lived', expiresAtSeconds))
    const connect: typeof withClientSession = async (_options, action) =>
      action({
        auth: { mint },
        target: { kernelIssuer: issuer('https://kernel.test') },
      } as never)
    const config = {
      session: {
        id: 'v-expiry',
        pid: 0,
        port: 0,
        nonce,
        pageUrl: '',
        view: {
          target: target('/:example.test'),
          route: {
            key: 'example.test:view.private',
            declaration: { target: { kind: 'domain' } },
            href: 'https://example.test/ui/private',
            handshake: 'shell',
            issuer: issuer('https://kernel.test'),
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
      externalOrigins: [],
      idleMs: 60_000,
    } satisfies ViewServeConfig
    const server = startViewServer(config, { connect })
    await once(server, 'listening')

    try {
      const response = await fetch(`${address(server)}/s/${nonce}/token`, { method: 'POST' })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        kind: 'minted',
        expiresAt: expiresAtSeconds * 1_000,
      })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  test.each([
    { label: 'unreadable by inspect', token: 'not-a-credential' },
    { label: 'an out-of-range expiration', token: mintedCredential('unbounded', 1e300) },
    { label: 'no expiration claim', token: mintedCredential('undated', Number.NaN) },
  ])('fails closed on a minted credential with $label', async ({ token }) => {
    const nonce = 'unbounded-view'
    // Issuance inspects every credential before returning it, so these cannot reach a live server;
    // the server still refuses to invent a lifetime it could not read.
    const mint = mock(async () => token)
    const connect: typeof withClientSession = async (_options, action) =>
      action({
        auth: { mint },
        target: { kernelIssuer: issuer('https://kernel.test') },
      } as never)
    const config = {
      session: {
        id: 'v-unbounded',
        pid: 0,
        port: 0,
        nonce,
        pageUrl: '',
        view: {
          target: target('/:example.test'),
          route: {
            key: 'example.test:view.private',
            declaration: { target: { kind: 'domain' } },
            href: 'https://example.test/ui/private',
            handshake: 'shell',
            issuer: issuer('https://kernel.test'),
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
      externalOrigins: [],
      idleMs: 60_000,
    } satisfies ViewServeConfig
    const server = startViewServer(config, { connect })
    await once(server, 'listening')

    try {
      const response = await fetch(`${address(server)}/s/${nonce}/token`, { method: 'POST' })

      expect(response.status).toBe(502)
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining('minted View credential'),
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
    const config = {
      session: {
        id: 'v-plain',
        pid: 0,
        port: 0,
        nonce,
        pageUrl: '',
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
      externalOrigins: ['https://connect.nango.dev'],
      idleMs: 60_000,
    } satisfies ViewServeConfig
    const server = startViewServer(config)
    await once(server, 'listening')

    try {
      const configResponse = await fetch(`${address(server)}/s/${nonce}/config.json`)
      expect(configResponse.status).toBe(200)
      const served = await configResponse.json()
      expect(served).not.toHaveProperty('transport')
      expect(served).toMatchObject({
        sessionId: 'v-plain',
        externalOrigins: ['https://connect.nango.dev'],
        // The page anticipates against the same delegation the server serves against.
        delegationTtlSeconds: VIEW_DELEGATION_TTL_SECONDS,
        view: config.session.view,
      })

      const response = await fetch(`${address(server)}/s/${nonce}/token`, {
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
