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
  writeFileSync(join(root, 'domain.ts'), 'export default {}\n')
  writeFileSync(join(root, 'schema/index.ts'), 'export const Test = {}\n')
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
  const contextPath = `/api/domain/${encodeURIComponent(handle.id)}/context`
  const mutation = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // The host matches Studio, but the scheme does not: this is not same-origin.
      origin: 'https://127.0.0.1',
    },
    body: JSON.stringify({ action: 'add', title: 'Injected', body: 'Must not persist' }),
  }

  const blocked = await route(contextPath, mutation)
  expect(blocked?.status).toBe(403)
  expect(await blocked?.json()).toEqual({ error: 'cross-site request blocked' })

  const wrongPort = await route(contextPath, {
    ...mutation,
    headers: { ...mutation.headers, origin: 'http://127.0.0.1:3000' },
  })
  expect(wrongPort?.status).toBe(403)

  const unchanged = await route(contextPath)
  expect(await unchanged?.json()).toEqual({ user: [], auto: [] })

  const allowed = await route(contextPath, {
    ...mutation,
    headers: { ...mutation.headers, origin: 'http://127.0.0.1' },
  })
  expect(allowed?.status).toBe(200)
  const stored = (await (await route(contextPath))?.json()) as { user: unknown[] }
  expect(stored.user).toHaveLength(1)
})

test('domain dispatch preserves context success, validation, and unknown-domain responses', async () => {
  const handle = fixture()
  const base = `/api/domain/${encodeURIComponent(handle.id)}`

  const context = await route(`${base}/context`)
  expect(context?.status).toBe(200)
  expect(await context?.json()).toEqual({ user: [], auto: [] })

  const invalid = await route(`${base}/context`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'invalid' }),
  })
  expect(invalid?.status).toBe(400)
  expect(await invalid?.json()).toEqual({ error: 'unknown context action' })

  const missing = await route('/api/domain/not-registered/context')
  expect(missing?.status).toBe(404)
  expect(await missing?.json()).toEqual({ error: 'not found' })
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
