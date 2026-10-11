import { afterEach, expect, test } from 'bun:test'

import { handleApi } from './api'
import { upsertComment } from './state/comments'
import { disposeTestDomains, testDomain } from './test-domain'

afterEach(disposeTestDomains)

async function route(path: string, init?: RequestInit) {
  const url = new URL(`http://127.0.0.1${path}`)
  return handleApi(new Request(url, init), url, () => {})
}

const post = (body: unknown, origin?: string): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
  body: JSON.stringify(body),
})

test('non-api paths fall through, and an unknown api path is the JSON 404', async () => {
  expect(await route('/assets/app.js')).toBeNull()
  const response = await route('/api/unknown')
  expect(response?.status).toBe(404)
  expect(await response?.json()).toEqual({ error: 'not found' })
  expect((await route('/api/domain/not-registered/visibility'))?.status).toBe(404)
})

test('a mutation from another origin is refused before it changes anything', async () => {
  const handle = testDomain()
  const visibility = `/api/domain/${encodeURIComponent(handle.id)}/visibility`
  const hide = { action: 'set', hidden: { 'class.Injected': true }, showInheritedEdges: false }

  // same host, other scheme or port: not the same origin
  for (const origin of [
    'https://127.0.0.1',
    'http://127.0.0.1:3000',
    'https://malicious.example',
  ]) {
    const blocked = await route(visibility, post(hide, origin))
    expect(blocked?.status).toBe(403)
    expect(await blocked?.json()).toEqual({ error: 'cross-site request blocked' })
  }
  expect(await (await route(visibility))?.json()).toEqual({ hidden: {}, showInheritedEdges: true })

  expect((await route(visibility, post(hide, 'http://127.0.0.1')))?.status).toBe(200)
  expect(await (await route(visibility))?.json()).toEqual({
    hidden: { 'class.Injected': true },
    showInheritedEdges: false,
  })
})

test('domain routes validate their bodies', async () => {
  const handle = testDomain()
  const base = `/api/domain/${encodeURIComponent(handle.id)}`

  const invalid = await route(`${base}/visibility`, post({ action: 'invalid' }))
  expect(await invalid?.json()).toEqual({ error: 'unknown visibility action' })
  // a body that is not an object is no action at all
  expect((await route(`${base}/visibility`, post(['set', { hidden: {} }])))?.status).toBe(400)

  const layout = await route(
    `${base}/layout`,
    post({ action: 'set', positions: { valid: { x: 12, y: 24 }, invalid: { x: '12', y: 24 } } }),
  )
  expect((await layout?.json()).positions).toEqual({ valid: { x: 12, y: 24 } })

  // a comment entry, once written, is never rewritten through the API
  const comment = upsertComment(handle.root, {
    anchors: ['Test'],
    anchorRefs: [{ ref: 'class.Test', kind: 'schema' }],
    text: 'Keep this wording',
  })
  const edit = await route(`${base}/comments`, post({ action: 'edit', id: comment.id, text: 'x' }))
  expect(await edit?.json()).toEqual({ error: 'comment entries cannot be edited' })
  expect(
    (await route(`${base}/comments`, post({ action: 'create', anchorRefs: [] })))?.status,
  ).toBe(400)
})

test('a manual refresh rebuilds every domain read and announces it, agent untouched', async () => {
  const handle = testDomain()
  const events: { type: string; domainId?: string }[] = []
  const url = new URL('http://127.0.0.1/api/workspace/refresh')
  const response = await handleApi(new Request(url, { method: 'POST' }), url, (event) =>
    events.push({ type: event.type, ...('domainId' in event && { domainId: event.domainId }) }),
  )

  expect(await response?.json()).toEqual({ refreshed: 1 })
  const types = events.map((event) => event.type)
  expect(types[0]).toBe('resolving')
  expect(types).toEqual(expect.arrayContaining(['schema-diff', 'anatomy-diff', 'datasets']))
  expect(types.some((type) => type.startsWith('agent'))).toBe(false)
  expect(events.every((event) => event.domainId === handle.id)).toBe(true)
})

test('an uploaded document is served back as data, never as a page of the studio origin', async () => {
  const handle = testDomain()
  const documents = `/api/domain/${encodeURIComponent(handle.id)}/context/documents`
  const form = new FormData()
  form.append('files', new File(['notes'], 'notes.txt', { type: 'text/plain' }))
  form.append('files', new File(['<script>'], 'Décisions.html', { type: 'text/html' }))
  const [text, html] = (await (await route(documents, { method: 'POST', body: form }))!.json()) as {
    id: string
  }[]

  const inline = await route(`${documents}/${text!.id}/raw`)
  expect(inline?.headers.get('content-type')).toBe('text/plain;charset=utf-8')
  expect(inline?.headers.get('content-disposition')).toBe('inline')
  expect(await inline?.text()).toBe('notes')

  // the uploader picks the MIME type, and this origin drives a local agent
  const download = await route(`${documents}/${html!.id}/raw`)
  expect(download?.headers.get('content-type')).toBe('application/octet-stream')
  expect(download?.headers.get('content-disposition')).toBe(
    "attachment; filename*=UTF-8''D%C3%A9cisions.html",
  )
  expect(download?.headers.get('x-content-type-options')).toBe('nosniff')
})
