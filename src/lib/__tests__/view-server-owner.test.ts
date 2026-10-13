import { describe, expect, mock, test } from 'bun:test'

import type { ViewServeConfig } from '../view/session'

import { createOwnerAccess } from '../view/owner'
import { instanceKernel, OWNER } from './view-owner.fixture'
import { HOST, serving, viewConfig } from './view.fixture'

/** An owner-mode session on `https://kernel.test` for `example.test`'s board View. */
function ownerConfig(nonce: string): ViewServeConfig {
  return viewConfig(nonce, {
    issuer: 'https://example.test',
    identity: 'Root',
    kernel: { instance: 'managed' },
    owner: OWNER,
  })
}

/** The session server's owner authority, doubled at the instance Kernel only. */
function owning(
  config: ViewServeConfig,
  kernel = instanceKernel({ routes: [config.session.view.route] }),
) {
  const persist = mock(async (_record: unknown) => {})
  return {
    kernel,
    persist,
    dependencies: {
      persist,
      owner: (owner: NonNullable<ViewServeConfig['owner']>, proxy: ViewServeConfig['proxy']) =>
        createOwnerAccess(owner, { url: proxy.kernelUrl, issuer: proxy.issuer }, kernel),
    },
  }
}

/** A loopback View host page: every response it reads is recorded, as the browser would see it. */
function page(session: string) {
  const seen: string[] = []
  let revision: number | undefined
  const call = async (
    path: string,
    init: RequestInit = {},
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(`${session}${path}`, {
      ...init,
      headers: {
        ...HOST,
        ...(revision === undefined ? {} : { 'x-astrale-view-revision': String(revision) }),
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
    })
    const text = await response.text()
    seen.push(text)
    return { status: response.status, body: text === '' ? undefined : JSON.parse(text) }
  }
  return {
    seen,
    get: (path: string) => call(path),
    post: (path: string, body?: unknown, headers?: Record<string, string>) =>
      call(
        path,
        { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
        headers,
      ),
    async load() {
      revision = undefined
      const config = await call('/config.json')
      revision = config.body.revision
      return config.body
    },
  }
}

describe('owner-mode View session', () => {
  test('runs as Root, switches to a listed Identity, and never hands the page root or impersonation', async () => {
    const config = ownerConfig('owner')
    const { kernel, persist, dependencies } = owning(config)
    await serving(config, dependencies, async (session) => {
      const host = page(session)
      expect(await host.load()).toMatchObject({ owner: true, identity: 'Root', revision: 0 })
      expect((await host.get('/identities')).body).toEqual({
        selected: null,
        identities: [
          { id: null, label: 'Root', kind: 'root' },
          { id: 'alice', label: 'alice@x.test', kind: 'user' },
          { id: 'bob', label: 'bob@x.test', kind: 'user' },
          { id: 'agent', label: 'Support agent', kind: 'identity', className: 'Agent' },
        ],
      })
      expect((await host.post('/token')).body).toMatchObject({
        token: 'exchanged:root@https://example.test',
        kind: 'exchanged',
      })
      expect((await host.post('/kernel-token')).body).toMatchObject({ kind: 'minted' })

      expect(await host.post('/identity', { identity: 'alice' })).toEqual({
        status: 200,
        body: { revision: 1 },
      })
      expect(persist.mock.calls.at(-1)?.[0]).toMatchObject({ identity: 'alice@x.test' })
      expect(await host.load()).toMatchObject({ identity: 'alice@x.test', revision: 1 })
      expect((await host.get('/identities')).body.selected).toBe('alice')
      expect((await host.post('/token')).body.token).toBe('exchanged:alice@https://example.test')
      expect((await host.post('/kernel-token')).body.kind).toBe('minted')
      // An in-place refresh keeps running as the selected Identity, resolving as root.
      expect((await host.post('/refresh')).body).toEqual({ revision: 2 })
      await host.load()
      expect((await host.post('/token')).body.token).toBe('exchanged:alice@https://example.test')

      // And back to Root.
      expect((await host.post('/identity', { identity: null })).status).toBe(200)
      expect(await host.load()).toMatchObject({ identity: 'Root', revision: 3 })
      expect((await host.post('/token')).body.token).toBe('exchanged:root@https://example.test')

      expect(kernel.authorities.length).toBeGreaterThanOrEqual(2)
      for (const authority of kernel.authorities) {
        for (const response of host.seen) expect(response).not.toContain(authority)
        for (const [record] of persist.mock.calls) {
          expect(JSON.stringify(record)).not.toContain(authority)
        }
      }
    })
  })

  test('admits only an identity the instance lists now, on the revision in force', async () => {
    const config = ownerConfig('owner-refusals')
    const { kernel, dependencies } = owning(config)
    await serving(config, dependencies, async (session) => {
      const host = page(session)
      await host.load()
      for (const identity of ['mallory', 42, undefined, '']) {
        expect(await host.post('/identity', { identity })).toEqual({
          status: 403,
          body: { error: 'Identity was not allowed for this View session.' },
        })
      }
      expect(
        (await host.post('/identity', { identity: 'alice' }, { 'x-astrale-view-revision': '7' }))
          .status,
      ).toBe(409)
      // A stale page acts on nothing, and its tokens are refused until it reloads.
      expect((await host.post('/identity', { identity: 'bob' })).status).toBe(200)
      expect((await host.post('/token')).status).toBe(409)
      expect(kernel.impersonate.mock.calls.map(([input]) => input.identity)).toEqual(['bob'])
    })
  })

  test('identities are the host page’s alone, and a CLI-identity session lists none', async () => {
    const config = ownerConfig('owner-host')
    await serving(config, owning(config).dependencies, async (session) => {
      const response = await fetch(`${session}/identities`, {
        headers: { origin: 'https://example.test' },
      })
      expect(response.status).toBe(403)
    })
    await serving(viewConfig('cli-identity', { handshake: 'none' }), {}, async (session) => {
      expect((await fetch(`${session}/identities`, { headers: HOST })).status).toBe(404)
    })
  })
})
