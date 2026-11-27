import { afterEach, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { LAYOUT_LIMITS, REQUEST_LIMITS } from '../shared/contracts/workspace'
import { agentWorkspace } from './agent/workspace'
import { handleApi } from './api'
import { upsertComment } from './state/comments'
import { disposeTestDomains, testDomain } from './test-domain'

afterEach(disposeTestDomains)

async function route(path: string, init?: RequestInit) {
  const url = new URL(`http://127.0.0.1${path}`)
  return handleApi(new Request(url, init), url, () => {})
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

test('non-api paths fall through, and an unknown api path is the JSON 404', async () => {
  expect(await route('/assets/app.js')).toBeNull()
  const response = await route('/api/unknown')
  expect(response?.status).toBe(404)
  expect(await response?.json()).toEqual({ error: 'not found' })
  expect((await route('/api/domain/not-registered/layout'))?.status).toBe(404)
})

test('domain routes validate their bodies', async () => {
  const handle = testDomain()
  const base = `/api/domain/${encodeURIComponent(handle.id)}`

  const invalid = await route(`${base}/layout`, post({ action: 'invalid', lens: 'structure' }))
  expect(await invalid?.json()).toEqual({ error: 'unknown layout action' })
  // a body that is not an object is no action at all
  expect((await route(`${base}/layout`, post(['set', { positions: {} }])))?.status).toBe(400)
  // every arrangement is a lens's: a placement that names none is refused
  const lensless = await route(
    `${base}/layout`,
    post({ action: 'set', positions: { valid: { x: 12, y: 24 } } }),
  )
  expect(await lensless?.json()).toEqual({ error: 'a layout write names its lens' })

  // a write that does not decode whole is refused whole, and changes nothing
  const refused = await route(
    `${base}/layout`,
    post({
      action: 'set',
      lens: 'structure',
      positions: { valid: { x: 12, y: 24 }, invalid: { x: '12', y: 24 } },
    }),
  )
  expect(refused?.status).toBe(400)
  expect(await refused?.json()).toEqual({
    error: 'the box invalid stands at no x and y within 10000000 of 0',
  })
  expect(await (await route(`${base}/layout`))?.json()).toEqual({})
  const layout = await route(
    `${base}/layout`,
    post({ action: 'set', lens: 'structure', positions: { valid: { x: 12, y: 24 } } }),
  )
  expect((await layout?.json()).lenses.structure).toEqual({ valid: { x: 12, y: 24 } })
  // and a later set merges into the stored layout rather than replacing it
  const merged = await route(
    `${base}/layout`,
    post({ action: 'set', lens: 'structure', positions: { next: { x: 1, y: 2 } } }),
  )
  expect((await merged?.json()).lenses.structure).toEqual({
    valid: { x: 12, y: 24 },
    next: { x: 1, y: 2 },
  })
  // shut modules belong to a lens, and are a list a write adds to and removes from
  const collapse = (body: object) => route(`${base}/layout`, post({ action: 'collapse', ...body }))
  expect((await collapse({ add: ['module.a'] }))?.status).toBe(400)
  expect((await collapse({ lens: 'behavior', add: 'module.a' }))?.status).toBe(400)
  // a whole set is no write: it names nothing added or removed
  expect((await collapse({ lens: 'behavior', groups: ['module.a'] }))?.status).toBe(400)
  expect(
    (await (await collapse({ lens: 'behavior', add: ['module.b', 'module.a'] }))?.json()).collapsed,
  ).toEqual({ behavior: ['module.a', 'module.b'] })
  // so are the folds opened by hand
  const open = (body: object) => route(`${base}/layout`, post({ action: 'open', ...body }))
  expect((await open({ add: ['class.A#call'] }))?.status).toBe(400)
  expect((await open({ lens: 'rules', add: 'class.A#call' }))?.status).toBe(400)
  expect(
    (await (await open({ lens: 'rules', add: ['class.B#read', 'class.A#call'] }))?.json()).opened,
  ).toEqual({ rules: ['class.A#call', 'class.B#read'] })
  expect((await route('/api/instances/use', post({ name: ' ' })))?.status).toBe(400)

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

test('the Workspace map keeps its arrangement on this machine, in no Domain', async () => {
  const handle = testDomain()
  const layout = '/api/workspace/layout'
  const box = `domain:${handle.id}`
  const placed = await route(
    layout,
    post({ action: 'set', lens: 'map', positions: { [box]: { x: 120.5, y: -40 } } }),
  )
  expect((await placed?.json()).lenses).toEqual({ map: { [box]: { x: 120.5, y: -40 } } })
  // read back whole by any reader, from the scanned workspace's machine-side state
  expect((await (await route(layout))?.json()).lenses).toEqual({
    map: { [box]: { x: 120.5, y: -40 } },
  })
  expect(existsSync(join(agentWorkspace().uiRoot, 'layout.json'))).toBe(true)
  expect(existsSync(join(handle.root, '.domain-studio', 'layout.json'))).toBe(false)

  // the same contract as a Domain's: shut groups per lens, a reset forgets the lens
  await route(layout, post({ action: 'collapse', lens: 'map', add: ['origin:x'] }))
  expect(await (await route(layout, post({ action: 'reset', lens: 'map' })))?.json()).toEqual({
    collapsed: { map: ['origin:x'] },
  })
  expect((await route(layout, post({ action: 'set', positions: {} })))?.status).toBe(400)
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

/** A body of `size` bytes of `fill`, streamed in 64 KiB chunks with no declared length. */
function streamed(size: number, fill = 0x20): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(64 * 1024).fill(fill)
  let left = size
  return new ReadableStream({
    pull(controller) {
      if (left <= 0) return controller.close()
      const next = chunk.subarray(0, Math.min(left, chunk.byteLength))
      left -= next.byteLength
      controller.enqueue(next)
    },
  })
}

test('every body a route reads is bounded: past REQUEST_LIMITS it is refused whole, before or as it arrives', async () => {
  const handle = testDomain()
  const layout = `/api/domain/${encodeURIComponent(handle.id)}/layout`
  const write = JSON.stringify({
    action: 'set',
    lens: 'structure',
    positions: { a: { x: 1, y: 2 } },
  })
  const json = { 'content-type': 'application/json' }

  // at the bound, a write is read; one byte past, it is refused and changes nothing
  const atBound = write + ' '.repeat(REQUEST_LIMITS.json - write.length)
  expect((await route(layout, { method: 'POST', headers: json, body: atBound }))?.status).toBe(200)
  await route(layout, post({ action: 'reset' }))
  const past = await route(layout, { method: 'POST', headers: json, body: `${atBound} ` })
  expect(past?.status).toBe(413)
  expect(await past?.json()).toEqual({
    error: 'a request body here is at most 4 MiB, and this one is larger',
  })
  expect(await (await route(layout))?.json()).toEqual({})

  // a declared length past the bound is refused before anything is read
  const declared = await route(layout, {
    method: 'POST',
    headers: { ...json, 'content-length': String(REQUEST_LIMITS.json + 1) },
    body: write,
  })
  expect(declared?.status).toBe(413)

  // a body that declares nothing is cut off as it arrives
  const stream = await route(layout, {
    method: 'POST',
    headers: json,
    body: streamed(REQUEST_LIMITS.json + 1),
  })
  expect(stream?.status).toBe(413)

  // the agent's routes read through the same bound
  expect(
    (
      await route('/api/agent/submit', {
        method: 'POST',
        headers: json,
        body: streamed(REQUEST_LIMITS.json + 1),
      })
    )?.status,
  ).toBe(413)

  // an upload has its own bound, and one that is not a form is refused
  const documents = `/api/domain/${encodeURIComponent(handle.id)}/context/documents`
  const upload = await route(documents, {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=x' },
    body: streamed(REQUEST_LIMITS.upload + 1, 0x78),
  })
  expect(upload?.status).toBe(413)
  expect(await upload?.json()).toEqual({
    error: 'a request body here is at most 32 MiB, and this one is larger',
  })
  const notForm = await route(documents, { method: 'POST', headers: json, body: '{}' })
  expect(notForm?.status).toBe(400)
  expect(await notForm?.json()).toEqual({ error: 'an upload is sent as a multipart form' })
  const image = await route('/api/agent/attachments', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=x' },
    body: streamed(REQUEST_LIMITS.upload + 1, 0x78),
  })
  expect(image?.status).toBe(413)
})

test('the sets a lens keeps are bounded in count and in id length', async () => {
  const handle = testDomain()
  const layout = `/api/domain/${encodeURIComponent(handle.id)}/layout`
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `module.m${index}`)
  expect(
    (
      await route(
        layout,
        post({ action: 'collapse', lens: 'structure', add: ids(LAYOUT_LIMITS.ids) }),
      )
    )?.status,
  ).toBe(200)
  const many = await route(
    layout,
    post({ action: 'open', lens: 'structure', add: ids(LAYOUT_LIMITS.ids + 1) }),
  )
  expect(many?.status).toBe(413)
  expect(await many?.json()).toEqual({ error: `the ids added name more than ${LAYOUT_LIMITS.ids}` })
  const long = await route(
    layout,
    post({ action: 'open', lens: 'structure', remove: ['m'.repeat(LAYOUT_LIMITS.id + 1)] }),
  )
  expect(long?.status).toBe(413)
  expect(await long?.json()).toEqual({
    error: `item 1 of the ids removed has an id longer than ${LAYOUT_LIMITS.id} characters`,
  })
  expect((await (await route(layout))?.json()).opened).toBeUndefined()
})

test('a malformed percent-escape in a path segment is refused, never an unhandled error', async () => {
  const handle = testDomain()
  const base = `/api/domain/${encodeURIComponent(handle.id)}`
  const cases: Array<[string, string]> = [
    ['/api/domain/%E0%A4%A/layout', 'the Domain id'],
    [`${base}/views/%ZZ/runtime`, 'the View slug'],
    [`${base}/context/documents/%E0%A4%A/raw`, 'the document id'],
    ['/api/agent/attachments/%', 'the attachment id'],
  ]
  for (const [path, what] of cases) {
    const response = await route(path)
    expect(response?.status).toBe(400)
    expect(await response?.json()).toEqual({
      error: `${what} in the path holds a malformed percent-escape`,
    })
  }
})
