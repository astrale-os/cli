import { describe, expect, mock, test } from 'bun:test'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'

import type { withClientSession } from '../../connection'
import type { ViewServeConfig } from '../view/session'

import { refreshViewPlacement } from '../view/refresh'
import { startViewServer } from '../view/server'

describe('in-place View refresh', () => {
  test('refuses a bookmark retargeted to another Kernel', async () => {
    const config = fixture()
    const viewsFor = mock(async () => ({ views: [config.session.view.route] }))
    const connect: typeof withClientSession = async (_options, action) =>
      action({
        session: { viewsFor },
        target: { url: 'https://another.test', kernelIssuer: 'https://another.test' },
      } as never)
    await expect(refreshViewPlacement(config, connect)).rejects.toThrow('another Kernel')
    expect(viewsFor).not.toHaveBeenCalled()
  })

  test('refuses to replace the selected View with another applicable View', async () => {
    const config = fixture()
    const connect: typeof withClientSession = async (_options, action) =>
      action({
        session: {
          viewsFor: async () => ({
            views: [{ ...config.session.view.route, key: 'app.test:view.other' }],
          }),
        },
        target: { url: config.proxy.kernelUrl, kernelIssuer: config.proxy.issuer },
      } as never)
    await expect(refreshViewPlacement(config, connect)).rejects.toThrow('no longer applicable')
  })

  test('re-resolves the same target, retains its URL, and notifies the existing page', async () => {
    const config = fixture()
    const updated = { ...config.session.view.route, href: 'https://app.test/new' }
    const viewsFor = mock(async () => ({ views: [updated] }))
    const persist = mock(async () => {})
    const connect: typeof withClientSession = async (options, action) => {
      expect(options).toEqual(config.kernel)
      return action({
        session: { viewsFor },
        target: { url: config.proxy.kernelUrl, kernelIssuer: config.proxy.issuer },
      } as never)
    }
    const server = startViewServer(config, { connect, persist })
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Missing server port')
    const base = `http://127.0.0.1:${address.port}/s/refresh/`
    try {
      const before = await (await fetch(`${base}config.json`)).json()
      expect(before.revision).toBe(0)
      expect((await fetch(`${base}refresh`, { method: 'POST' })).status).toBe(200)
      const after = await (await fetch(`${base}config.json`)).json()
      expect(after).toMatchObject({
        sessionId: before.sessionId,
        revision: 1,
        view: { target: '@item', route: { href: 'https://app.test/new' } },
      })
      expect(viewsFor).toHaveBeenCalledWith('@item')
      expect(persist).toHaveBeenCalledWith(
        expect.objectContaining({
          id: config.session.id,
          pageUrl: config.session.pageUrl,
          view: { target: '@item', route: updated },
        }),
      )
      const heartbeat = await fetch(`${base}status`, {
        method: 'POST',
        body: JSON.stringify({ state: 'alive' }),
      })
      expect(await heartbeat.json()).toEqual({ revision: 1 })
      expect((await fetch(`${base}refresh`)).status).toBe(404)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  test('retains the last good placement and revision when re-resolution fails', async () => {
    const config = fixture()
    const persist = mock(async () => {})
    const connect: typeof withClientSession = async () => {
      throw new Error('Kernel unavailable')
    }
    const server = startViewServer(config, { connect, persist })
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Missing server port')
    const base = `http://127.0.0.1:${address.port}/s/refresh/`
    try {
      expect((await fetch(`${base}refresh`, { method: 'POST' })).status).toBe(502)
      const current = await (await fetch(`${base}config.json`)).json()
      expect(current).toMatchObject({ revision: 0, view: config.session.view })
      expect(persist).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

function fixture(identities?: boolean): ViewServeConfig {
  return {
    session: {
      id: 'v-refresh',
      pid: 0,
      port: 0,
      nonce: 'refresh',
      pageUrl: 'http://127.0.0.1/s/refresh/',
      ...(identities === undefined ? {} : { identity: 'alice' }),
      createdAt: '2026-09-05T00:00:00.000Z',
      view: {
        target: '@item' as ViewServeConfig['session']['view']['target'],
        route: {
          key: 'app.test:view.item',
          href: 'https://app.test/old',
          handshake: identities === undefined ? 'none' : 'shell',
          issuer: 'https://app.test' as ViewServeConfig['session']['view']['route']['issuer'],
          etag: `sha256:${'a'.repeat(64)}`,
          revision:
            `sha256:${'b'.repeat(64)}` as ViewServeConfig['session']['view']['route']['revision'],
          declaration: {
            target: {
              kind: 'definition',
              definitions: [{ origin: 'app.test', kind: 'class', name: 'Item' }],
            },
          },
        },
      },
    },
    kernel: { instance: 'retained', as: identities === undefined ? 'owner' : 'alice' },
    proxy: { kernelUrl: 'https://kernel.test', issuer: 'https://kernel.test', direct: true },
    externalOrigins: [],
    ...(identities ? { identities: ['alice', 'bob'] } : {}),
    idleMs: 60_000,
  } satisfies ViewServeConfig
}

type IdentityHooks = {
  identities?: false
  mint?: (identity: string) => Promise<string>
  resolve?: (identity: string) => Promise<void>
  persist?: () => Promise<void>
}

async function withIdentityView(
  hooks: IdentityHooks,
  run: (view: Awaited<ReturnType<typeof setupIdentityView>>) => unknown,
) {
  const view = await setupIdentityView(hooks)
  try {
    await run(view)
  } finally {
    await view.close()
  }
}

async function setupIdentityView(hooks: IdentityHooks) {
  const config = fixture(hooks.identities !== false)
  const callers: string[] = []
  const records: string[] = []
  const connect: typeof withClientSession = async (options, action) => {
    const identity = options.as!
    callers.push(identity)
    return action({
      target: { url: config.proxy.kernelUrl, kernelIssuer: config.proxy.issuer },
      session: {
        viewsFor: async () => {
          await hooks.resolve?.(identity)
          return { views: [config.session.view.route] }
        },
      },
      auth: { mint: () => hooks.mint?.(identity) ?? Promise.resolve(`credential-${identity}`) },
    } as never)
  }
  const server = startViewServer(config, {
    connect,
    persist: async (record) => {
      await hooks.persist?.()
      records.push(record.identity!)
    },
  })
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing port')
  const origin = `http://127.0.0.1:${address.port}`
  const request = (path: string, revision = 0, body?: object, headers = {}) =>
    fetch(`${origin}/s/refresh/${path}`, {
      method: path === 'config.json' ? 'GET' : 'POST',
      headers: {
        origin,
        'x-astrale-view-host': '1',
        'x-astrale-view-revision': String(revision),
        'content-type': 'application/json',
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  return {
    request,
    callers,
    records,
    origin,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe('View identity switching', () => {
  test('re-resolves and mints as the selected identity while invalidating the old page', () =>
    withIdentityView({}, async ({ request, callers, records }) => {
      expect(await (await request('token')).json()).toMatchObject({ token: 'credential-alice' })
      expect((await request('identity', 0, { identity: 'bob' })).status).toBe(200)
      expect(await (await request('config.json')).json()).toMatchObject({
        identity: 'bob',
        revision: 1,
        identities: ['alice', 'bob'],
      })
      expect(records).toEqual(['bob'])
      expect(callers).toEqual(['alice', 'bob', 'bob'])
      expect((await request('token', 0)).status).toBe(409)
      expect(await (await request('token', 1)).json()).toMatchObject({ token: 'credential-bob' })
    }))

  test('requires opt-in, an allowed identity, and same-origin host requests', async () => {
    await withIdentityView({}, async ({ request, callers }) => {
      expect((await request('identity', 0, { identity: 'root' })).status).toBe(403)
      expect(
        (await request('identity', 0, { identity: 'bob' }, { origin: 'https://app.test' })).status,
      ).toBe(403)
      expect((await request('token', 0, undefined, { 'x-astrale-view-host': '' })).status).toBe(403)
      expect(callers).toEqual([])
    })
    await withIdentityView({ identities: false }, async ({ request, callers }) => {
      expect((await request('identity', 0, { identity: 'bob' })).status).toBe(403)
      expect(callers).toEqual([])
    })
  })

  test.each(['resolve', 'mint', 'persist'] as const)(
    'retains the working identity if %s fails',
    (phase) =>
      withIdentityView(
        {
          [phase]: async (identity: string) => {
            if (identity === 'bob' || phase === 'persist') throw new Error('Denied')
            return 'credential-alice'
          },
        },
        async ({ request, records }) => {
          expect((await request('identity', 0, { identity: 'bob' })).status).toBe(502)
          expect(await (await request('config.json')).json()).toMatchObject({
            identity: 'alice',
            revision: 0,
          })
          expect(await (await request('token')).json()).toMatchObject({
            token: 'credential-alice',
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

  test('does not cache a delayed credential from the previous identity', () => {
    const started = Promise.withResolvers<void>()
    const delayed = Promise.withResolvers<string>()
    return withIdentityView(
      {
        mint: (identity) => {
          if (identity !== 'alice') return Promise.resolve('credential-bob')
          started.resolve()
          return delayed.promise
        },
      },
      async ({ request }) => {
        const old = request('token')
        await started.promise
        expect((await request('identity', 0, { identity: 'bob' })).status).toBe(200)
        delayed.resolve('credential-alice')
        expect((await old).status).toBe(502)
        expect(await (await request('token', 1)).json()).toMatchObject({ token: 'credential-bob' })
      },
    ).finally(() => delayed.resolve('credential-alice'))
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
        delayed.resolve()
        expect((await first).status).toBe(200)
      },
    ).finally(() => delayed.resolve())
  })
})
