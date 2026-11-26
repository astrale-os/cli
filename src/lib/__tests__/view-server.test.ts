import { describe, expect, mock, test } from 'bun:test'

import type { withClientSession } from '../../connection'

import { HOST, mintedCredential, serving, viewConfig } from './view.fixture'

const issuer = (value: string) => value as never

function connecting(mint: () => Promise<string>, kernel = 'https://kernel.test') {
  const connect = mock(
    async (_options: unknown, action: (context: never) => unknown, intent: unknown) => {
      expect(intent).toEqual({ principal: 'caller', nestedTtlSeconds: 240 })
      return action({
        auth: { mint },
        target: { url: kernel, kernelIssuer: issuer(kernel) },
      } as never)
    },
  )
  return connect as unknown as typeof withClientSession & typeof connect
}

const post = (url: string, headers: Record<string, string> = HOST) =>
  fetch(url, { method: 'POST', headers })

/** The host page asking for the credential of the View release `view` names. */
const token = (session: string, view: unknown) =>
  fetch(`${session}/token`, {
    method: 'POST',
    headers: { ...HOST, 'content-type': 'application/json' },
    body: JSON.stringify({ view }),
  })

describe('view session credentials', () => {
  test.each([
    { name: 'a View on its own Domain issuer gets an exchanged credential', external: true },
    { name: 'a View on the Kernel issuer gets a minted credential', external: false },
    { name: 'an explicit --creds caller is never exchanged', external: true, explicit: true },
  ])('$name', async ({ external, explicit }) => {
    const mint = mock(async () => mintedCredential('minted'))
    const exchange = mock(async () => ({ token: 'exchanged', expiresAt: Date.now() + 240_000 }))
    const config = viewConfig('bound', {
      issuer: external ? 'https://example.test' : 'https://kernel.test',
      kernel: explicit ? { creds: 'explicit-caller-proof' } : { as: 'dispatcher' },
    })
    const exchanged = external && !explicit

    await serving(config, { connect: connecting(mint), exchange }, async (session) => {
      expect(await (await token(session, config.session.view)).json()).toMatchObject(
        exchanged
          ? { token: 'exchanged', kind: 'exchanged' }
          : { token: mintedCredential('minted'), kind: 'minted' },
      )
      // The host's own Kernel credential is always minted for the Kernel audience.
      expect(await (await post(`${session}/kernel-token`)).json()).toMatchObject({
        kind: 'minted',
      })
    })
    expect(mint).toHaveBeenCalledWith({ audience: 'https://kernel.test', ttlSeconds: 240 })
    if (exchanged) {
      expect(exchange).toHaveBeenCalledWith(config.kernel, {
        url: 'https://kernel.test',
        kernelIssuer: 'https://kernel.test',
        domainIssuer: 'https://example.test',
      })
    } else {
      expect(exchange).not.toHaveBeenCalled()
    }
  })

  test('a Shell View runs on a Kernel credential of the caller, never on a Domain one', async () => {
    const mint = mock(async () => mintedCredential('minted'))
    const exchange = mock(async () => ({ token: 'exchanged', expiresAt: Date.now() + 240_000 }))
    const config = viewConfig('shell', { issuer: 'https://shell.astrale.ai' })
    const route = config.session.view.route as { key: string }
    route.key = 'shell.astrale.ai:view.application'
    await serving(config, { connect: connecting(mint), exchange }, async (session) => {
      expect(await (await token(session, config.session.view)).json()).toMatchObject({
        kind: 'minted',
      })
    })
    expect(exchange).not.toHaveBeenCalled()
  })

  test('serves concurrent page requests from one mint, then reuses the grant', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const connect = connecting(async () => {
      await held
      return mintedCredential('minted')
    })

    const config = viewConfig('shared')
    await serving(config, { connect }, async (session) => {
      const pending = [1, 2, 3].map(() => token(session, config.session.view))
      release()
      const bodies = await Promise.all((await Promise.all(pending)).map((one) => one.json()))
      expect(bodies.map((body) => body.token)).toEqual(Array(3).fill(mintedCredential('minted')))
      await token(session, config.session.view)
    })
    expect(connect).toHaveBeenCalledTimes(1)
  })

  test("serves the minted credential's own expiration and fails closed without one", async () => {
    // Shorter than the requested 240 seconds: the issuer decides, not the request.
    const expiresAt = Math.floor(Date.now() / 1_000) + 180
    const dated = connecting(async () => mintedCredential('short', expiresAt))
    const view = viewConfig('dated').session.view
    await serving(viewConfig('dated'), { connect: dated }, async (session) => {
      expect(await (await token(session, view)).json()).toMatchObject({
        kind: 'minted',
        expiresAt: expiresAt * 1_000,
      })
    })

    const undated = connecting(async () => mintedCredential('undated', Number.NaN))
    await serving(viewConfig('undated'), { connect: undated }, async (session) => {
      const response = await token(session, view)
      expect(response.status).toBe(502)
      expect((await response.json()).error).toContain('minted View credential')
    })
  })

  /** @evidence TEST-CLI-PLAIN-VIEW-RECEIVES-NO-CREDENTIAL */
  test('refuses every credential to a handshake-none View', async () => {
    const config = viewConfig('plain', {
      handshake: 'none',
      kernel: { creds: 'must-not-be-used' },
      externalOrigins: ['https://connect.nango.dev'],
    })
    await serving(config, {}, async (session) => {
      const served = await (await fetch(`${session}/config.json`, { headers: HOST })).json()
      expect(served).not.toHaveProperty('transport')
      expect(served).toMatchObject({
        sessionId: 'v-plain',
        externalOrigins: ['https://connect.nango.dev'],
        view: config.session.view,
      })
      for (const response of [
        await token(session, config.session.view),
        await post(`${session}/kernel-token`),
      ]) {
        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
          error: 'plain views have no Astrale credential privilege',
        })
      }
    })
  })

  test('mints nothing once the bookmark points at another Kernel', async () => {
    const connect = connecting(async () => 'must-not-be-minted', 'https://other.test')
    const config = viewConfig('repointed', { identity: 'alice' })
    await serving(config, { connect }, async (session) => {
      const response = await token(session, config.session.view)
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({
        error: 'The session bookmark now points to another Kernel. Open a new View.',
      })
    })
  })
})

describe('a credential for the release each window runs', () => {
  const at = (issuer: string | undefined) => {
    const { view } = viewConfig('release').session
    const { issuer: _issuer, ...route } = view.route
    return { ...view, route: issuer === undefined ? route : { ...route, issuer } }
  }

  test('issues each release the credential of its own Domain issuer, and reuses each one', async () => {
    const mint = mock(async () => mintedCredential('minted'))
    const exchange = mock(async (_kernel: unknown, target: { domainIssuer?: string }) => ({
      token: `exchanged@${target.domainIssuer}`,
      expiresAt: Date.now() + 240_000,
    }))
    const config = viewConfig('releases', { issuer: 'https://example.test' })
    await serving(config, { connect: connecting(mint), exchange }, async (session) => {
      const issued = async (view: unknown) => (await (await token(session, view)).json()).token
      // The release the session opened, the release a redeploy moved its window to, and the first
      // again, for a window still within its in-flight window: each one its own.
      expect(await issued(at('https://example.test'))).toBe('exchanged@https://example.test')
      expect(await issued(at('https://next.example.test'))).toBe(
        'exchanged@https://next.example.test',
      )
      expect(await issued(at('https://example.test'))).toBe('exchanged@https://example.test')
      // A release the Kernel executes runs on the caller's Kernel credential.
      expect(await issued(at(undefined))).toBe(mintedCredential('minted'))
    })
    expect(exchange.mock.calls.map(([, target]) => target.domainIssuer)).toEqual([
      'https://example.test',
      'https://next.example.test',
    ])
    expect(mint).toHaveBeenCalledTimes(1)
  })

  test('refuses a request that names no View release, or a plain one', async () => {
    const connect = connecting(async () => 'must-not-be-minted')
    const config = viewConfig('unnamed')
    await serving(config, { connect }, async (session) => {
      expect((await post(`${session}/token`)).status).toBe(400)
      for (const view of [null, 'board', { target: '/:example.test' }, at('not an issuer')]) {
        expect((await token(session, view)).status).toBe(400)
      }
      const plain = {
        ...config.session.view,
        route: { ...config.session.view.route, handshake: 'none' },
      }
      expect(await (await token(session, plain)).json()).toEqual({
        error: 'plain views have no Astrale credential privilege',
      })
    })
    expect(connect).not.toHaveBeenCalled()
  })
})

describe('view session ownership and host authority', () => {
  const GRACE_MS = 30
  const settle = () => new Promise((resolve) => setTimeout(resolve, GRACE_MS * 4))

  async function attached(
    nonce: string,
    body: (call: Caller, exit: ReturnType<typeof mock>) => Promise<void>,
  ) {
    const exit = mock((_code: number) => undefined)
    const config = viewConfig(nonce, { handshake: 'none', kernel: {}, releaseGraceMs: GRACE_MS })
    await serving(config, { exit }, (session) =>
      body(
        (path, json, headers = {}) =>
          fetch(`${session}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(json),
          }),
        exit,
      ).then(() => undefined),
    )
    return exit
  }
  type Caller = (path: string, json: unknown, headers?: Record<string, string>) => Promise<Response>

  test('a released session outlives its host while another page holds it, then ends', async () => {
    let ended: unknown
    const exit = await attached('popped-out', async (call, exit) => {
      await call('/status', { state: 'alive', page: 'studio-dialog' })
      await call('/status', { state: 'alive', page: 'operator-tab' })
      const released = await call('/release', { page: 'studio-dialog' }, HOST)
      expect(await released.json()).toEqual({ released: true, attached: 1 })
      await settle()
      ended = exit.mock.calls.length
      await call('/status', { state: 'gone', page: 'operator-tab' })
      await settle()
    })
    expect(ended).toBe(0)
    expect(exit).toHaveBeenCalledWith(0)
  })

  test('a page the host handed back cannot take the session back; a reload keeps it', async () => {
    const handedBack = await attached('raced', async (call) => {
      await call('/status', { state: 'alive', page: 'studio-dialog' })
      await call('/release', { page: 'studio-dialog' }, HOST)
      // The heartbeat the dialog had already sent when it went away.
      await call('/status', { state: 'alive', page: 'studio-dialog' })
      await settle()
    })
    expect(handedBack).toHaveBeenCalledWith(0)

    const reloaded = await attached('reloaded', async (call) => {
      await call('/status', { state: 'alive', page: 'operator-tab' })
      await call('/release', {}, HOST)
      await call('/status', { state: 'gone', page: 'operator-tab' })
      await call('/status', { state: 'alive', page: 'operator-tab-reloaded' })
      await settle()
    })
    expect(reloaded).not.toHaveBeenCalled()
  })

  test.each([
    '/config.json',
    '/identities',
    '/identity',
    '/release',
    '/current',
    '/token',
    '/kernel-token',
  ])('refuses %s to anything but the View host', async (route) => {
    await serving(viewConfig('host-only', { handshake: 'none' }), {}, async (session) => {
      const response = await fetch(`${session}${route}`, {
        method: ['/config.json', '/identities', '/current'].includes(route) ? 'GET' : 'POST',
        headers: { origin: 'https://example.test' },
      })
      expect(response.status).toBe(403)
    })
  })

  test('a session opened without identities offers none and switches to none', async () => {
    const config = viewConfig('bound-identity', { handshake: 'none', identity: 'alice' })
    await serving(config, {}, async (session) => {
      const served = await (await fetch(`${session}/config.json`, { headers: HOST })).json()
      expect(served.identity).toBe('alice')
      expect(served).not.toHaveProperty('identities')
      const switched = await fetch(`${session}/identity`, {
        method: 'POST',
        headers: { ...HOST, 'content-type': 'application/json' },
        body: JSON.stringify({ identity: 'bob' }),
      })
      expect(switched.status).toBe(403)
    })
  })
})
