import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { handleApi } from './api'
import { registerDomain, unregisterDomain } from './domain'

const roots: string[] = []
const domainIds: string[] = []

afterEach(() => {
  while (domainIds.length) unregisterDomain(domainIds.pop()!)
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'studio-api-contract-'))
  roots.push(root)
  mkdirSync(join(root, 'schema'))
  writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
  writeFileSync(join(root, 'schema/index.ts'), 'export const Test = {}\n')
  writeFileSync(
    join(root, 'application.ts'),
    `import { defineApplication } from '@astrale-os/sdk/application'
import { Test } from './schema/index.js'
export default defineApplication({ schema: Test, runtime: {} as never })
`,
  )
  const handle = registerDomain(root)!
  domainIds.push(handle.id)
  return handle
}

async function route(path: string, init?: RequestInit) {
  const url = new URL(`http://127.0.0.1${path}`)
  return handleApi(new Request(url, init), url, () => {})
}

test('router ignores non-api paths and returns the stable JSON 404 for unknown API paths', async () => {
  expect(await route('/assets/app.js')).toBeNull()

  const response = await route('/api/unknown')
  expect(response?.status).toBe(404)
  expect(response?.headers.get('content-type')).toBe('application/json')
  expect(await response?.json()).toEqual({ error: 'not found' })
})

test('router blocks cross-site mutations before route dispatch but permits same-origin requests', async () => {
  const blocked = await route('/api/unknown', {
    method: 'POST',
    headers: { origin: 'https://malicious.example' },
  })
  expect(blocked?.status).toBe(403)
  expect(await blocked?.json()).toEqual({ error: 'cross-site request blocked' })

  const sameOrigin = await route('/api/unknown', {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1' },
  })
  expect(sameOrigin?.status).toBe(404)
})

test('cross-site protection compares the complete origin and leaves mutation state unchanged', async () => {
  const handle = fixture()
  const visibilityPath = `/api/domain/${encodeURIComponent(handle.id)}/visibility`
  const mutation = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // The host matches Studio, but the scheme does not: this is not same-origin.
      origin: 'https://127.0.0.1',
    },
    body: JSON.stringify({
      action: 'set',
      hidden: { 'class.Injected': true },
      showInheritedEdges: false,
    }),
  }

  const blocked = await route(visibilityPath, mutation)
  expect(blocked?.status).toBe(403)
  expect(await blocked?.json()).toEqual({ error: 'cross-site request blocked' })

  const wrongPort = await route(visibilityPath, {
    ...mutation,
    headers: { ...mutation.headers, origin: 'http://127.0.0.1:3000' },
  })
  expect(wrongPort?.status).toBe(403)

  const unchanged = await route(visibilityPath)
  expect(await unchanged?.json()).toEqual({ hidden: {}, showInheritedEdges: true })

  const allowed = await route(visibilityPath, {
    ...mutation,
    headers: { ...mutation.headers, origin: 'http://127.0.0.1' },
  })
  expect(allowed?.status).toBe(200)
  expect(await (await route(visibilityPath))?.json()).toEqual({
    hidden: { 'class.Injected': true },
    showInheritedEdges: false,
  })
})

test('domain dispatch preserves canvas success, validation, and unknown-domain responses', async () => {
  const handle = fixture()
  const base = `/api/domain/${encodeURIComponent(handle.id)}`

  const visibility = await route(`${base}/visibility`)
  expect(visibility?.status).toBe(200)
  expect(await visibility?.json()).toEqual({ hidden: {}, showInheritedEdges: true })

  const invalid = await route(`${base}/visibility`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'invalid' }),
  })
  expect(invalid?.status).toBe(400)
  expect(await invalid?.json()).toEqual({ error: 'unknown visibility action' })

  const nonObjectBody = await route(`${base}/visibility`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(['set', { hidden: { 'class.Injected': true } }]),
  })
  expect(nonObjectBody?.status).toBe(400)
  expect(await (await route(`${base}/visibility`))?.json()).toEqual({
    hidden: {},
    showInheritedEdges: true,
  })

  const filteredLayout = await route(`${base}/layout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'set',
      positions: { valid: { x: 12, y: 24 }, invalid: { x: '12', y: 24 } },
    }),
  })
  expect((await filteredLayout?.json()).positions).toEqual({ valid: { x: 12, y: 24 } })

  const missing = await route('/api/domain/not-registered/visibility')
  expect(missing?.status).toBe(404)
  expect(await missing?.json()).toEqual({ error: 'not found' })
})

test('retired internal domain routes return the stable JSON 404', async () => {
  const handle = fixture()
  const base = `/api/domain/${encodeURIComponent(handle.id)}`
  for (const path of ['/context', '/copy-payload', '/integrations', '/instance']) {
    const response = await route(`${base}${path}`)
    expect(response?.status).toBe(404)
    expect(await response?.json()).toEqual({ error: 'not found' })
  }
})

test('workspace dispatch preserves catalog responses and instance request validation', async () => {
  const handle = fixture()

  const catalog = await route('/api/catalog')
  expect(catalog?.status).toBe(200)
  const origins = (await catalog?.json()).map((entry: { origin: string }) => entry.origin)
  expect(origins[0]).toBe('kernel.astrale.ai')
  expect(origins).toContain(handle.id)

  const invalidInstance = await route('/api/instances/use', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '   ' }),
  })
  expect(invalidInstance?.status).toBe(400)
  expect(await invalidInstance?.json()).toEqual({ error: 'name is required' })
})

test('workspace exposes live introspection queue and per-phase timings', async () => {
  const response = await route('/api/workspace/introspection')
  expect(response?.status).toBe(200)
  expect(await response?.json()).toMatchObject({
    concurrency: 2,
    active: expect.any(Array),
    queued: { reader: expect.any(Array), background: expect.any(Array) },
    domains: expect.any(Array),
  })
})

test('multipart document upload remains ahead of JSON parsing and raw download keeps its media type', async () => {
  const handle = fixture()
  const base = `/api/domain/${encodeURIComponent(handle.id)}`
  const form = new FormData()
  form.append('files', new File(['contract body'], 'contract.txt', { type: 'text/plain' }))

  const uploaded = await route(`${base}/context/documents`, { method: 'POST', body: form })
  expect(uploaded?.status).toBe(200)
  const documents = (await uploaded?.json()) as Array<{ id: string; type: string }>
  expect(documents).toHaveLength(1)

  const raw = await route(`${base}/context/documents/${encodeURIComponent(documents[0]!.id)}/raw`)
  expect(raw?.status).toBe(200)
  expect(raw?.headers.get('content-type')).toBe('text/plain;charset=utf-8')
  expect(await raw?.text()).toBe('contract body')
})
