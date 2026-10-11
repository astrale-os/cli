import { describe, expect, mock, test } from 'bun:test'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'

import type { withClientSession } from '../../connection'
import type { ViewServeConfig } from '../view/session'

import { refreshViewPlacement } from '../view/refresh'
import { HOST, mintedCredential, serving, viewConfig } from './view.fixture'

type Route = ViewServeConfig['session']['view']['route']

/** A refreshable View session; with `identities`, it may switch between alice and bob. */
function fixture(identities?: boolean, external = true): ViewServeConfig {
  return viewConfig('refresh', {
    handshake: identities === undefined ? 'none' : 'shell',
    issuer: external ? 'https://example.test' : 'https://kernel.test',
    ...(identities === undefined ? {} : { identity: 'alice' }),
    kernel: { instance: 'retained', as: identities === undefined ? 'owner' : 'alice' },
    ...(identities ? { identities: ['alice', 'bob'] } : {}),
  })
}

/** A Kernel connection on the session's own Kernel answering `viewsFor` with `views`. */
function kernelWith(config: ViewServeConfig, viewsFor: () => Promise<{ views: Route[] }>) {
  const connect: typeof withClientSession = async (options, action) => {
    expect(options).toEqual(config.kernel)
    return action({
      session: { viewsFor },
      target: { url: config.proxy.kernelUrl, kernelIssuer: config.proxy.issuer },
    } as never)
  }
  return connect
}

describe('in-place View refresh', () => {
  test('refuses a retargeted bookmark or a View no longer published, never swapping in another', async () => {
    const config = fixture()
    const viewsFor = mock(async () => ({ views: [config.session.view.route] }))
    const retargeted: typeof withClientSession = async (_options, action) =>
      action({
        session: { viewsFor },
        target: { url: 'https://another.test', kernelIssuer: 'https://another.test' },
      } as never)
    await expect(refreshViewPlacement(config, retargeted)).rejects.toThrow('another Kernel')
    expect(viewsFor).not.toHaveBeenCalled()

    const other = { ...config.session.view.route, key: 'example.test:view.other' as Route['key'] }
    const connect = kernelWith(config, async () => ({ views: [other] }))
    await expect(refreshViewPlacement(config, connect)).rejects.toThrow('no longer published')
  })

  test('re-resolves the same View in its Domain, retains its URL, and notifies the existing page', async () => {
    const config = fixture()
    const updated = { ...config.session.view.route, href: 'https://example.test/new' }
    const viewsFor = mock(async () => ({ views: [updated] }))
    const persist = mock(async () => {})
    await serving(config, { connect: kernelWith(config, viewsFor), persist }, async (base) => {
      const before = await (await fetch(`${base}/config.json`, { headers: HOST })).json()
      expect(before.revision).toBe(0)
      expect((await fetch(`${base}/refresh`, { method: 'POST' })).status).toBe(200)
      const after = await (await fetch(`${base}/config.json`, { headers: HOST })).json()
      expect(after).toMatchObject({
        sessionId: before.sessionId,
        revision: 1,
        view: { target: '/:example.test', route: { href: 'https://example.test/new' } },
      })
      expect(viewsFor).toHaveBeenCalledWith('/:example.test')
      expect(persist).toHaveBeenCalledWith(
        expect.objectContaining({
          id: config.session.id,
          pageUrl: config.session.pageUrl,
          view: { target: '/:example.test', route: updated },
        }),
      )
      const heartbeat = await fetch(`${base}/status`, {
        method: 'POST',
        body: JSON.stringify({ state: 'alive' }),
      })
      expect(await heartbeat.json()).toEqual({ revision: 1 })
      expect((await fetch(`${base}/refresh`)).status).toBe(404)
    })
  })

  test('retains the last good placement and revision when re-resolution fails', async () => {
    const config = fixture()
    const persist = mock(async () => {})
    const connect: typeof withClientSession = async () => {
      throw new Error('Kernel unavailable')
    }
    await serving(config, { connect, persist }, async (base) => {
      expect((await fetch(`${base}/refresh`, { method: 'POST' })).status).toBe(502)
      const current = await (await fetch(`${base}/config.json`, { headers: HOST })).json()
      expect(current).toMatchObject({ revision: 0, view: config.session.view })
      expect(persist).not.toHaveBeenCalled()
    })
  })
})

type IdentityHooks = {
  identities?: false
  mint?: (identity: string) => Promise<string>
  exchange?: (identity: string, issuer: string) => Promise<string>
  resolve?: (identity: string) => Promise<void | ViewServeConfig['session']['view']['route']>
  persist?: () => Promise<void>
}

/** Serve an identity-switching View whose Kernel answers through `hooks`, and run `body`. */
async function withIdentityView(
  hooks: IdentityHooks,
  body: (view: {
    request: (path: string, revision?: number, json?: object, headers?: object) => Promise<Response>
    callers: string[]
    records: string[]
    origin: string
  }) => Promise<void>,
) {
  const config = fixture(hooks.identities !== false, hooks.exchange !== undefined)
  const callers: string[] = []
  const records: string[] = []
  const connect: typeof withClientSession = async (options, action) => {
    const identity = options.as!
    callers.push(identity)
    return action({
      target: {
        url: config.proxy.kernelUrl,
        kernelIssuer: config.proxy.issuer,
        ...(hooks.exchange ? { domainIssuer: 'https://managed.test' } : {}),
      },
      session: {
        viewsFor: async () => ({
          views: [(await hooks.resolve?.(identity)) ?? config.session.view.route],
        }),
      },
      auth: {
        mint: () =>
          hooks.mint?.(identity) ?? Promise.resolve(mintedCredential(`credential-${identity}`)),
      },
    } as never)
  }
  const exchange = async (options: { as?: string }, target: { domainIssuer?: string }) => ({
    token: await hooks.exchange!(options.as!, target.domainIssuer!),
    expiresAt: Date.now() + 240_000,
  })
  const persist = async (record: { identity?: string }) => {
    await hooks.persist?.()
    records.push(record.identity!)
  }
  await serving(config, { connect, exchange, persist } as never, (session) => {
    const origin = new URL(session).origin
    const request = (path: string, revision = 0, json?: object, headers = {}) =>
      fetch(`${session}/${path}`, {
        method: path === 'config.json' ? 'GET' : 'POST',
        headers: {
          origin,
          ...HOST,
          'x-astrale-view-revision': String(revision),
          'content-type': 'application/json',
          ...headers,
        },
        ...(json ? { body: JSON.stringify(json) } : {}),
      })
    return body({ request, callers, records, origin })
  })
}

describe('View identity switching', () => {
  test('uses the newly resolved View issuer on identity switch and refresh', () => {
    const route = fixture(true).session.view.route
    let next = route
    const exchanged: string[] = []
    return withIdentityView(
      {
        resolve: async () => next,
        exchange: async (identity, issuer) => {
          const token = `${identity}:${issuer}`
          exchanged.push(token)
          return token
        },
      },
      async ({ request }) => {
        expect(await (await request('token')).json()).toMatchObject({
          token: 'alice:https://example.test',
        })
        next = { ...route, issuer: 'https://new-app.test' as typeof route.issuer }
        expect((await request('identity', 0, { identity: 'bob' })).status).toBe(200)
        expect(await (await request('token', 1)).json()).toMatchObject({
          token: 'bob:https://new-app.test',
        })
        next = { ...route, issuer: 'https://refreshed-app.test' as typeof route.issuer }
        expect((await request('refresh', 1)).status).toBe(200)
        expect(await (await request('token', 2)).json()).toMatchObject({
          token: 'bob:https://refreshed-app.test',
        })
        expect(exchanged).toEqual([
          'alice:https://example.test',
          'bob:https://new-app.test',
          'bob:https://refreshed-app.test',
        ])
      },
    )
  })

  test('re-resolves and mints as the selected identity while invalidating the old page', () =>
    withIdentityView({}, async ({ request, callers, records }) => {
      expect(await (await request('token')).json()).toMatchObject({
        token: mintedCredential('credential-alice'),
      })
      expect((await request('identity', 0, { identity: 'bob' })).status).toBe(200)
      expect(await (await request('config.json')).json()).toMatchObject({
        identity: 'bob',
        revision: 1,
        identities: ['alice', 'bob'],
      })
      expect(records).toEqual(['bob'])
      expect(callers).toEqual(['alice', 'bob', 'bob'])
      expect((await request('token', 0)).status).toBe(409)
      expect((await request('kernel-token', 0)).status).toBe(409)
      expect(await (await request('token', 1)).json()).toMatchObject({
        token: mintedCredential('credential-bob'),
      })
    }))

  test('requires opt-in, an allowed identity, and same-origin host requests', async () => {
    await withIdentityView({}, async ({ request, callers }) => {
      expect((await request('identity', 0, { identity: 'root' })).status).toBe(403)
      expect(
        (await request('identity', 0, { identity: 'bob' }, { origin: 'https://example.test' }))
          .status,
      ).toBe(403)
      expect((await request('token', 0, undefined, { 'x-astrale-view-host': '' })).status).toBe(403)
      expect(callers).toEqual([])
    })
    await withIdentityView({ identities: false }, async ({ request, callers }) => {
      expect((await request('identity', 0, { identity: 'bob' })).status).toBe(403)
      expect(callers).toEqual([])
    })
  })

  test.each(['resolve', 'persist'] as const)('retains the working identity if %s fails', (phase) =>
    withIdentityView(
      {
        [phase]: async (identity: string) => {
          if (identity === 'bob' || phase === 'persist') throw new Error('Denied')
          return mintedCredential('credential-alice')
        },
      },
      async ({ request, records }) => {
        expect((await request('identity', 0, { identity: 'bob' })).status).toBe(502)
        expect(await (await request('config.json')).json()).toMatchObject({
          identity: 'alice',
          revision: 0,
        })
        expect(await (await request('token')).json()).toMatchObject({
          token: mintedCredential('credential-alice'),
        })
        expect(records).toEqual([])
      },
    ),
  )

  test('rejects a stale switch whose body arrives after another switch commits', () =>
    withIdentityView({}, async ({ request, records, origin }) => {
      const slow = httpRequest(`${origin}/s/refresh/identity`, {
        method: 'POST',
        headers: {
          origin,
          expect: '100-continue',
          'x-astrale-view-host': '1',
          'x-astrale-view-revision': '0',
        },
      })
      const response = new Promise<number>((resolve, reject) => {
        slow.on('response', (result) => {
          result.resume()
          resolve(result.statusCode!)
        })
        slow.on('error', reject)
      })
      try {
        const admitted = once(slow, 'continue')
        slow.flushHeaders()
        await admitted
        expect((await request('identity', 0, { identity: 'bob' })).status).toBe(200)
        slow.end(JSON.stringify({ identity: 'alice' }))
        expect(await response).toBe(409)
        expect(records).toEqual(['bob'])
      } finally {
        slow.destroy()
      }
    }))

  test('does not cache a delayed mint from the previous identity', () => {
    const started = Promise.withResolvers<void>()
    const delayed = Promise.withResolvers<string>()
    return withIdentityView(
      {
        mint: (identity: string) => {
          if (identity !== 'alice') return Promise.resolve(mintedCredential('credential-bob'))
          started.resolve()
          return delayed.promise
        },
      },
      async ({ request }) => {
        const old = request('token')
        await started.promise
        expect((await request('identity', 0, { identity: 'bob' })).status).toBe(200)
        delayed.resolve(mintedCredential('credential-alice'))
        expect((await old).status).toBe(502)
        expect(await (await request('token', 1)).json()).toMatchObject({
          token: mintedCredential('credential-bob'),
        })
      },
    ).finally(() => delayed.resolve(mintedCredential('credential-alice')))
  })

  test('blocks other session updates while switching identity', () => {
    const started = Promise.withResolvers<void>()
    const delayed = Promise.withResolvers<void>()
    return withIdentityView(
      {
        resolve: async () => {
          started.resolve()
          await delayed.promise
        },
      },
      async ({ request }) => {
        const first = request('identity', 0, { identity: 'bob' })
        await started.promise
        expect((await request('identity', 0, { identity: 'alice' })).status).toBe(409)
        expect((await request('refresh')).status).toBe(409)
        expect((await request('token')).status).toBe(409)
        expect((await request('kernel-token')).status).toBe(409)
        delayed.resolve()
        expect((await first).status).toBe(200)
      },
    ).finally(() => delayed.resolve())
  })
})
