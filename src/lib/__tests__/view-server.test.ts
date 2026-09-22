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

/** What the loopback host page sends on every host-only route. */
const HOST = { 'x-astrale-view-host': '1' }

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
          url: 'https://kernel.test',
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
        headers: HOST,
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
          url: 'https://kernel.test',
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
        target: { url: 'https://kernel.test', kernelIssuer: issuer('https://kernel.test') },
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
      const token = () =>
        fetch(`${address(server)}/s/${nonce}/token`, { method: 'POST', headers: HOST })
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
      const configResponse = await fetch(`${address(server)}/s/${nonce}/config.json`, {
        headers: HOST,
      })
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
        headers: HOST,
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

describe('view session ownership', () => {
  const GRACE_MS = 30

  function attachedConfig(nonce: string): ViewServeConfig {
    return {
      session: {
        id: `v-${nonce}`,
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
      kernel: {},
      proxy: { kernelUrl: 'https://kernel.test', issuer: 'https://kernel.test', direct: true },
      externalOrigins: [],
      // Long enough that nothing here can be the idle rule firing by accident.
      idleMs: 600_000,
      releaseGraceMs: GRACE_MS,
    } satisfies ViewServeConfig
  }

  /** Give the release grace room to elapse, then let its timer run. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 4))
  }

  function started(nonce: string) {
    const exit = mock((_code: number) => undefined)
    const server = startViewServer(attachedConfig(nonce), {
      connect: (async () => {
        throw new Error('This View mints nothing')
      }) as unknown as typeof withClientSession,
      exit,
    })
    const call = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${address(server)}/s/${nonce}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })
    return { server, exit, call }
  }

  test('a released session outlives its host while another page holds it', async () => {
    const { server, exit, call } = started('popped-out')
    await once(server, 'listening')

    try {
      // The dialog Studio mounted, and the tab the operator popped the View into.
      expect((await call('/status', { state: 'alive', page: 'studio-dialog' })).status).toBe(200)
      expect((await call('/status', { state: 'alive', page: 'operator-tab' })).status).toBe(200)

      const released = await call(
        '/release',
        { page: 'studio-dialog' },
        { 'x-astrale-view-host': '1' },
      )
      expect(released.status).toBe(200)
      expect(await released.json()).toEqual({ released: true, attached: 1 })

      await settle()
      expect(exit).not.toHaveBeenCalled()
      // The tab is still served, which is the whole point of releasing.
      expect((await call('/status', { state: 'alive', page: 'operator-tab' })).status).toBe(200)

      // It ends when that tab goes, not before.
      expect((await call('/status', { state: 'gone', page: 'operator-tab' })).status).toBe(200)
      await settle()
      expect(exit).toHaveBeenCalledWith(0)
    } finally {
      server.close()
    }
  })

  test('a page a host handed back cannot take the session back', async () => {
    const { server, exit, call } = started('raced')
    await once(server, 'listening')

    try {
      await call('/status', { state: 'alive', page: 'studio-dialog' })
      await call('/release', { page: 'studio-dialog' }, { 'x-astrale-view-host': '1' })
      // The heartbeat the dialog had already sent when the dialog went away.
      const late = await call('/status', { state: 'alive', page: 'studio-dialog' })
      expect(late.status).toBe(200)

      await settle()
      expect(exit).toHaveBeenCalledWith(0)
    } finally {
      server.close()
    }
  })

  test('a released session with no page left shuts down', async () => {
    const { server, exit, call } = started('unheld')
    await once(server, 'listening')

    try {
      await call('/status', { state: 'alive', page: 'studio-dialog' })
      await call('/release', { page: 'studio-dialog' }, { 'x-astrale-view-host': '1' })
      await settle()
      expect(exit).toHaveBeenCalledWith(0)
    } finally {
      server.close()
    }
  })

  test('a page that comes back within the grace keeps the session', async () => {
    const { server, exit, call } = started('reloaded')
    await once(server, 'listening')

    try {
      await call('/status', { state: 'alive', page: 'operator-tab' })
      await call('/release', {}, { 'x-astrale-view-host': '1' })
      // A reload: the page leaves and the fresh load reports under a new id.
      await call('/status', { state: 'gone', page: 'operator-tab' })
      await call('/status', { state: 'alive', page: 'operator-tab-reloaded' })

      await settle()
      expect(exit).not.toHaveBeenCalled()
    } finally {
      server.close()
    }
  })

  test('a page leaving a session nobody released only leaves it idle', async () => {
    const { server, exit, call } = started('terminal')
    await once(server, 'listening')

    try {
      // `astrale view` has no host to release the session: the idle budget alone ends it.
      await call('/status', { state: 'alive', page: 'agent-browser' })
      await call('/status', { state: 'gone', page: 'agent-browser' })
      await settle()
      expect(exit).not.toHaveBeenCalled()
    } finally {
      server.close()
    }
  })

  test('releasing is refused to anything but the View host', async () => {
    const { server, exit, call } = started('guarded')
    await once(server, 'listening')

    try {
      const response = await call('/release', { page: 'operator-tab' })
      expect(response.status).toBe(403)
      await settle()
      expect(exit).not.toHaveBeenCalled()
    } finally {
      server.close()
    }
  })

  test('leaving does not become the state a snapshot run waits on', async () => {
    const { server, call } = started('reported')
    await once(server, 'listening')

    try {
      await call('/status', { state: 'connected', page: 'operator-tab' })
      await call('/status', { state: 'gone', page: 'operator-tab' })
      const state = await (await fetch(`${address(server)}/s/reported/state`)).json()
      expect(state).toMatchObject({ state: 'connected' })
    } finally {
      server.close()
    }
  })
})

describe('view session host authority', () => {
  function hostConfig(nonce: string, handshake: 'none' | 'shell'): ViewServeConfig {
    return {
      session: {
        id: `v-${nonce}`,
        pid: 0,
        port: 0,
        nonce,
        pageUrl: '',
        view: {
          target: target('/:example.test'),
          route: {
            key: 'example.test:view.board',
            declaration: { target: { kind: 'domain' } },
            href: 'https://example.test/ui/board',
            handshake,
            issuer: issuer('https://kernel.test'),
            etag: digest('a'),
            revision: revision('b'),
          },
        },
        identity: 'alice',
        createdAt: '2026-09-22T00:00:00.000Z',
      },
      kernel: { instance: 'staging', as: 'alice' },
      proxy: { kernelUrl: 'https://kernel.test', issuer: 'https://kernel.test', direct: true },
      externalOrigins: [],
      idleMs: 600_000,
    } satisfies ViewServeConfig
  }

  /**
   * Studio opens a View on the identity its instance is bound to and sends no
   * list to switch between, so the page has no selector to render.
   */
  test('a session opened without identities offers none and switches to none', async () => {
    const nonce = 'bound-identity'
    const server = startViewServer(hostConfig(nonce, 'none'))
    await once(server, 'listening')

    try {
      const served = await (
        await fetch(`${address(server)}/s/${nonce}/config.json`, { headers: HOST })
      ).json()
      expect(served.identity).toBe('alice')
      expect(served).not.toHaveProperty('identities')

      const switched = await fetch(`${address(server)}/s/${nonce}/identity`, {
        method: 'POST',
        headers: { ...HOST, 'content-type': 'application/json' },
        body: JSON.stringify({ identity: 'bob' }),
      })
      expect(switched.status).toBe(403)
      expect(await switched.json()).toEqual({
        error: 'Identity was not allowed for this View session.',
      })
    } finally {
      server.close()
    }
  })

  /** The embedded View reaches none of it, identity switching configured or not. */
  test.each(['/config.json', '/identity', '/release', '/token'])(
    'refuses %s to anything but the View host',
    async (route) => {
      const nonce = 'host-only'
      const server = startViewServer(hostConfig(nonce, 'none'))
      await once(server, 'listening')

      try {
        const response = await fetch(`${address(server)}${`/s/${nonce}`}${route}`, {
          method: route === '/config.json' ? 'GET' : 'POST',
          headers: { origin: 'https://example.test' },
        })
        expect(response.status).toBe(403)
      } finally {
        server.close()
      }
    },
  )

  test('mints nothing once the bookmark points at another Kernel', async () => {
    const nonce = 'repointed'
    const connect: typeof withClientSession = async (_options, action) =>
      action({
        auth: { mint: async () => 'must-not-be-minted' },
        target: { url: 'https://other.test', kernelIssuer: issuer('https://other.test') },
      } as never)
    const server = startViewServer(hostConfig(nonce, 'shell'), { connect })
    await once(server, 'listening')

    try {
      const response = await fetch(`${address(server)}/s/${nonce}/token`, {
        method: 'POST',
        headers: HOST,
      })
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({
        error: 'The session bookmark now points to another Kernel. Open a new View.',
      })
    } finally {
      server.close()
    }
  })
})
