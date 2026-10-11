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
      expect(await (await post(`${session}/token`)).json()).toMatchObject(
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

  test('serves concurrent page requests from one mint, then reuses the grant', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const connect = connecting(async () => {
      await held
      return mintedCredential('minted')
    })

    await serving(viewConfig('shared'), { connect }, async (session) => {
      const pending = [1, 2, 3].map(() => post(`${session}/token`))
      release()
      const bodies = await Promise.all((await Promise.all(pending)).map((one) => one.json()))
      expect(bodies.map((body) => body.token)).toEqual(Array(3).fill(mintedCredential('minted')))
      await post(`${session}/token`)
    })
    expect(connect).toHaveBeenCalledTimes(1)
  })

  test("serves the minted credential's own expiration and fails closed without one", async () => {
    // Shorter than the requested 240 seconds: the issuer decides, not the request.
    const expiresAt = Math.floor(Date.now() / 1_000) + 180
    const dated = connecting(async () => mintedCredential('short', expiresAt))
    await serving(viewConfig('dated'), { connect: dated }, async (session) => {
      expect(await (await post(`${session}/token`)).json()).toMatchObject({
        kind: 'minted',
        expiresAt: expiresAt * 1_000,
      })
    })

    const undated = connecting(async () => mintedCredential('undated', Number.NaN))
    await serving(viewConfig('undated'), { connect: undated }, async (session) => {
      const response = await post(`${session}/token`)
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
      for (const endpoint of ['token', 'kernel-token']) {
        const response = await post(`${session}/${endpoint}`)
        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
          error: 'plain views have no Astrale credential privilege',
        })
      }
    })
  })

  test('mints nothing once the bookmark points at another Kernel', async () => {
    const connect = connecting(async () => 'must-not-be-minted', 'https://other.test')
    await serving(viewConfig('repointed', { identity: 'alice' }), { connect }, async (session) => {
      const response = await post(`${session}/token`)
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({
        error: 'The session bookmark now points to another Kernel. Open a new View.',
      })
    })
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

  test.each(['/config.json', '/identity', '/release', '/token', '/kernel-token'])(
    'refuses %s to anything but the View host',
    async (route) => {
      await serving(viewConfig('host-only', { handshake: 'none' }), {}, async (session) => {
        const response = await fetch(`${session}${route}`, {
          method: route === '/config.json' ? 'GET' : 'POST',
          headers: { origin: 'https://example.test' },
        })
        expect(response.status).toBe(403)
      })
    },
  )

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
