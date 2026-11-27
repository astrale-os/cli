import { expect, test } from 'bun:test'

import type { DomainHandle } from '../domain/registry'
import type { Versions } from '../workspace/versions/service'
import type { DomainRouteContext } from './http'

import { handleDomainVersionsRoute, handleVersionsRoute } from './versions'

const handle = { id: 'issues', root: '/nowhere' } as DomainHandle

/** A service that answers each call with its own name and arguments. */
function recordingVersions() {
  const calls: unknown[][] = []
  const answer =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args.map((arg) => (arg === handle ? 'handle' : arg))])
      return { answered: name }
    }
  const service = {
    locals: answer('locals'),
    standing: answer('standing'),
    dependencies: answer('dependencies'),
    registry: { domains: answer('domains'), index: answer('index') },
    changes: { report: answer('report') },
    compatibility: { matrix: answer('matrix'), verdict: answer('verdict') },
    publisher: {
      start: async (_handle: DomainHandle, body: unknown) => {
        calls.push(['start', body])
        const request = body as { look?: string }
        return request.look === 'spent'
          ? { ok: false, status: 409, refusal: { error: 'look-missing', message: 'look again' } }
          : { ok: true, events: new Response('{"type":"started"}\n').body! }
      },
    },
  } as unknown as Versions
  return { calls, versionsOf: () => service }
}

const get = (path: string) => new Request(`http://studio.test${path}`)

function domainContext(
  path: string,
  method = 'GET',
  body: Record<string, unknown> = {},
): DomainRouteContext {
  const url = new URL(`http://studio.test/api/domain/issues${path}`)
  return {
    req: new Request(url, { method }),
    url,
    rest: path,
    body,
    handle,
    notify: () => {},
  } as DomainRouteContext
}

test('workspace routes answer from the service; the address is checked before it is used', async () => {
  const { calls, versionsOf } = recordingVersions()
  const route = (path: string) =>
    handleVersionsRoute(get(path), new URL(`http://studio.test${path}`), versionsOf)
  expect(await (await route('/api/versions'))!.json()).toEqual({ answered: 'locals' })
  await route('/api/registry/domains')
  await route('/api/registry/versions?origin=shell.astrale.ai&fresh=1')
  expect(calls).toEqual([['locals'], ['domains'], ['index', 'shell.astrale.ai', { fresh: true }]])
  expect((await route('/api/registry/versions?origin=--json'))!.status).toBe(400)
  expect(calls).toHaveLength(3)
  // A Publication's Schema is read as a Domain's, at /api/domain/@registry:<origin>@<version>.
  expect(await route('/api/registry/schema?origin=shell.astrale.ai&version=0.1.0')).toBeNull()
  expect(await route('/api/elsewhere')).toBeNull()
  expect(
    await handleVersionsRoute(
      new Request('http://studio.test/api/versions', { method: 'POST' }),
      new URL('http://studio.test/api/versions'),
      versionsOf,
    ),
  ).toBeNull()
})

test('Domain routes reach the service under their own paths', async () => {
  const { calls, versionsOf } = recordingVersions()
  const route = (path: string, query = '') => {
    const context = domainContext(path)
    context.url = new URL(`${context.url.href}${query}`)
    return handleDomainVersionsRoute(context, versionsOf)
  }
  await route('/versions')
  await route('/versions/changes', '?fresh=1')
  await route('/versions/dependencies')
  await route('/versions/compatibility')
  await route('/versions/compatibility', '?origin=shell.astrale.ai&version=0.1.0')
  await route('/versions/compatibility', '?origin=shell.astrale.ai&local=1')
  expect(calls).toEqual([
    ['standing', 'handle', { fresh: false }],
    ['report', 'handle', { fresh: true }],
    ['dependencies', 'handle', { fresh: false }],
    ['matrix', 'handle', { fresh: false }],
    ['verdict', 'handle', { origin: 'shell.astrale.ai', version: '0.1.0' }],
    ['verdict', 'handle', { origin: 'shell.astrale.ai', local: true }],
  ])
  expect((await route('/versions/compatibility', '?origin=shell.astrale.ai'))!.status).toBe(400)
  expect(await route('/versioning')).toBeNull()
  expect(await route('/versions/unknown')).toBeNull()
})

test('Publish answers its event stream, or its refusal with the refusal status', async () => {
  const { calls, versionsOf } = recordingVersions()
  const started = await handleDomainVersionsRoute(
    domainContext('/versions/publish', 'POST', { environment: 'production', look: 'fresh' }),
    versionsOf,
  )
  expect(started!.headers.get('content-type')).toBe('application/x-ndjson')
  expect(started!.headers.get('cache-control')).toBe('no-store')
  expect(await started!.text()).toBe('{"type":"started"}\n')
  const refused = await handleDomainVersionsRoute(
    domainContext('/versions/publish', 'POST', { environment: 'production', look: 'spent' }),
    versionsOf,
  )
  expect(refused!.status).toBe(409)
  expect(await refused!.json()).toEqual({ error: 'look-missing', message: 'look again' })
  // Publish is a POST only.
  expect(await handleDomainVersionsRoute(domainContext('/versions/publish'), versionsOf)).toBeNull()
  expect(calls).toEqual([
    ['start', { environment: 'production', look: 'fresh' }],
    ['start', { environment: 'production', look: 'spent' }],
  ])
})
