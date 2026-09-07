import { describe, expect, mock, test } from 'bun:test'
import { once } from 'node:events'

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

function fixture(): ViewServeConfig {
  return {
    session: {
      id: 'v-refresh',
      pid: 0,
      port: 0,
      nonce: 'refresh',
      pageUrl: 'http://127.0.0.1/s/refresh/',
      createdAt: '2026-09-05T00:00:00.000Z',
      view: {
        target: '@item' as ViewServeConfig['session']['view']['target'],
        route: {
          key: 'app.test:view.item',
          href: 'https://app.test/old',
          handshake: 'none',
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
    kernel: { instance: 'retained', as: 'owner' },
    proxy: { kernelUrl: 'https://kernel.test', issuer: 'https://kernel.test', direct: true },
    externalOrigins: [],
    idleMs: 60_000,
  } satisfies ViewServeConfig
}
