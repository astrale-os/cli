import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Remote, RemoteFailure } from '../../shared/contracts/versions'
import type { Versions } from '../workspace/versions/service'

import { publishedDomainId, type PublishedSchemaBundle } from '../../shared/contracts/versions'
import { handleApi } from '../api'
import { admittedBundle, revision } from '../workspace/versions/test-fixtures'
import { handlePublicationRoute, publicationStateRoot } from './publication'

const home = process.env.ASTRALE_HOME
const homes: string[] = []
afterEach(() => {
  if (home === undefined) delete process.env.ASTRALE_HOME
  else process.env.ASTRALE_HOME = home
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true })
})

function machineHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-publication-home-'))
  homes.push(root)
  process.env.ASTRALE_HOME = root
  return root
}

const ORIGIN = 'issues.astrale.ai'
const READ_AT = '2026-11-27T00:00:00.000Z'

function publishedBundle(version: string): PublishedSchemaBundle {
  const schemaRevision = revision(`issues-${version}`)
  return {
    ...admittedBundle(publishedDomainId(ORIGIN, version), ORIGIN, schemaRevision),
    renderFingerprint: `render-${version}`,
    publication: {
      origin: ORIGIN,
      version,
      schemaRevision,
      releaseDigest: `sha256:${'c'.repeat(64)}`,
      bundleDigest: `sha256:${'d'.repeat(64)}`,
      publishedAt: '2026-11-25T00:00:00.000Z',
      yanked: false,
      decodedBy: { sdk: '0.6.0-beta.71' },
    },
  }
}

/**
 * A versions service whose only Publication answer is `answer`, recording what it was asked; a
 * Publication it answered is one it has opened.
 */
function answering(answer: (version: string) => Remote<PublishedSchemaBundle>) {
  const opened: unknown[][] = []
  const renders = new Map<string, string>()
  const service = {
    published: {
      open: async (origin: string, version: string, options?: { fresh?: boolean }) => {
        opened.push([origin, version, options])
        const answered = answer(version)
        if (answered.status === 'ok')
          renders.set(`${origin}@${version}`, answered.value.renderFingerprint)
        return answered
      },
      openedRender: (origin: string, version: string) => renders.get(`${origin}@${version}`),
    },
  } as unknown as Versions
  return { opened, versionsOf: () => service }
}

/** A request through the API's own addressing, as the browser sends it. */
async function dispatch(id: string, rest: string, init?: RequestInit): Promise<Response> {
  const url = `http://127.0.0.1/api/domain/${encodeURIComponent(id)}${rest}`
  return (await handleApi(new Request(url, init), new URL(url), () => {}))!
}

const ok = (version: string): Remote<PublishedSchemaBundle> => ({
  status: 'ok',
  value: publishedBundle(version),
  readAt: READ_AT,
})

const failure = (status: RemoteFailure['status'], code?: string): RemoteFailure => ({
  status,
  ...(code ? { code } : {}),
  message: `the registry answered ${status}`,
  readAt: READ_AT,
})

function call(
  versionsOf: () => Versions,
  rest: string,
  init?: RequestInit,
  version = '0.9.0',
): Promise<Response> {
  const url = `http://127.0.0.1/api/domain/${encodeURIComponent(publishedDomainId(ORIGIN, version))}${rest}`
  return handlePublicationRoute(
    new Request(url, init),
    new URL(url),
    rest.split('?')[0],
    { origin: ORIGIN, version },
    versionsOf,
  )
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

test('an opened Publication answers its bundle; a fresh read asks the registry again', async () => {
  const { opened, versionsOf } = answering(ok)
  const response = await call(versionsOf, '/bundle')
  expect(response.status).toBe(200)
  const bundle = (await response.json()) as PublishedSchemaBundle
  expect(bundle.domainId).toBe(publishedDomainId(ORIGIN, '0.9.0'))
  expect(bundle.publication).toMatchObject({ origin: ORIGIN, version: '0.9.0' })
  await call(versionsOf, '/bundle?fresh=1')
  expect(opened).toEqual([
    [ORIGIN, '0.9.0', { fresh: false }],
    [ORIGIN, '0.9.0', { fresh: true }],
  ])
})

test('each registry failure answers as itself, under the HTTP status it stands for', async () => {
  const cases: Array<[RemoteFailure, number]> = [
    [failure('signed-out', 'AUTH_ERROR'), 401],
    [failure('refused', 'REGISTRY_FORBIDDEN'), 403],
    [failure('not-found', 'PUBLICATION_NOT_FOUND'), 404],
    [failure('offline', 'CONNECTION_ERROR'), 503],
    [failure('failed'), 502],
  ]
  for (const [answer, status] of cases) {
    const { versionsOf } = answering(() => answer)
    const response = await call(versionsOf, '/bundle')
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(answer)
  }
})

test('a Publication is read-only: no threads, no writes but the reader arrangement', async () => {
  machineHome()
  const { versionsOf } = answering(ok)
  expect(await (await call(versionsOf, '/comments')).json()).toEqual({
    schemaVersion: 'render-0.9.0',
    comments: [],
  })
  // Whatever the registry answers, there is no thread to read.
  const unreachable = answering(() => failure('offline'))
  expect(await (await call(unreachable.versionsOf, '/comments')).json()).toEqual({
    schemaVersion: '',
    comments: [],
  })
  // every write but its arrangement is refused in one place, before the Publication's routes
  const id = publishedDomainId(ORIGIN, '0.9.0')
  const comment = await dispatch(id, '/comments', post({ action: 'create', text: 'hi' }))
  expect(comment.status).toBe(403)
  expect(await comment.json()).toEqual({ error: 'A Publication is read-only in Studio.' })
  for (const rest of [
    '/publish',
    '/agent',
    '/scenarios',
    '/project',
    '/views',
    '/context/documents',
  ]) {
    expect((await dispatch(id, rest, post({}))).status).toBe(403)
    expect((await dispatch(id, rest, { method: 'DELETE' })).status).toBe(403)
    expect((await call(versionsOf, rest)).status).toBe(404)
  }
  const anatomy = await (await call(versionsOf, '/anatomy')).json()
  expect(anatomy).toMatchObject({ overview: { origin: ORIGIN, schemaDir: '' }, views: [], env: [] })
})

test('the arrangement is kept on this machine, one record per origin across its versions', async () => {
  const root = machineHome()
  const { opened, versionsOf } = answering(ok)

  // a write asks the registry nothing: a Publication this Studio has not opened is not arranged
  const unopened = await call(
    versionsOf,
    '/layout',
    post({ action: 'set', lens: 'structure', positions: { 'class.Issue': { x: 4, y: 2 } } }),
  )
  expect(unopened.status).toBe(409)
  expect(await unopened.json()).toEqual({
    error: `This Studio has not opened ${ORIGIN} 0.9.0: open it before arranging it.`,
  })
  expect(opened).toEqual([])
  expect(existsSync(publicationStateRoot(ORIGIN))).toBe(false)

  await call(versionsOf, '/bundle')
  opened.length = 0
  const placed = await call(
    versionsOf,
    '/layout',
    post({ action: 'set', lens: 'structure', positions: { 'class.Issue': { x: 4, y: 2 } } }),
  )
  expect(await placed.json()).toMatchObject({
    renderFingerprint: 'render-0.9.0',
    lenses: { structure: { 'class.Issue': { x: 4, y: 2 } } },
  })
  // Another version of the same origin reads the same arrangement: box ids name Classes.
  expect(await (await call(versionsOf, '/layout', undefined, '0.8.10')).json()).toMatchObject({
    lenses: { structure: { 'class.Issue': { x: 4, y: 2 } } },
  })
  expect(publicationStateRoot(ORIGIN)).toBe(join(root, 'studio', 'publications', ORIGIN))
  expect(readdirSync(join(root, 'studio'))).toEqual(['publications'])
  expect(readdirSync(publicationStateRoot(ORIGIN))).toEqual(['layout.json'])
  // neither the write nor the reads after it asked the registry
  expect(opened).toEqual([])

  // a version the registry could not open is not one this Studio has opened
  const unreachable = answering(() => failure('signed-out'))
  await call(unreachable.versionsOf, '/bundle', undefined, '0.8.10')
  const refused = await call(
    unreachable.versionsOf,
    '/layout',
    post({ action: 'set', lens: 'rules', positions: { 'class.Issue': { x: 1, y: 1 } } }),
    '0.8.10',
  )
  expect(refused.status).toBe(409)
})

test('the API addresses a Publication by its Domain id; a malformed one addresses nothing', async () => {
  machineHome()
  const anatomy = await dispatch(publishedDomainId(ORIGIN, '0.9.0'), '/anatomy')
  expect(anatomy.status).toBe(200)
  expect((await anatomy.json()).overview.origin).toBe(ORIGIN)
  expect((await dispatch(publishedDomainId(ORIGIN, '0.9.0'), '/publish', post({}))).status).toBe(
    403,
  )
  for (const id of [
    '@registry:issues.astrale.ai',
    '@registry:--json@0.9.0',
    '@registry:issues.astrale.ai@latest',
  ]) {
    expect((await dispatch(id, '/anatomy')).status).toBe(404)
    expect((await dispatch(id, '/layout', post({ action: 'reset' }))).status).toBe(404)
  }
  expect(existsSync(join(process.env.ASTRALE_HOME!, 'studio', 'publications'))).toBe(false)
})
