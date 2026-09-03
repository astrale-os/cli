import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StudioSchemaBundle } from '../shared/types'

import { decodeBundleCacheEntry, getAnatomy, getBundle, invalidate, stillStands } from './cache'
import { registerDomain, unregisterDomain } from './domain'

const roots: string[] = []
const domainIds: string[] = []

afterEach(() => {
  while (domainIds.length) {
    const id = domainIds.pop()!
    invalidate(id, 'all')
    unregisterDomain(id)
  }
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function entry(): Record<string, unknown> {
  return {
    version: 6,
    key: 'cache-key',
    futureEntryField: { version: 6 },
    bundle: {
      domainId: 'notes',
      renderFingerprint: 'render-hash',
      schemaMode: 'canonical-preview',
      extractedBy: 'runtime-bun',
      depsInstalled: true,
      ir: {
        format: 'astrale.dsl',
        version: 'v1',
        domain: 'notes.example.dev',
        classes: {},
        importsByKey: {},
        importedClassesByKey: {},
        functions: {},
        views: {},
        policies: {},
        dependencies: [],
        core: {},
      },
      overlay: {
        handlerLinks: [],
        sourceSpans: {},
      },
      schemaRoot: {
        format: 'astrale.dsl',
        version: 'v1',
        origin: 'notes.example.dev',
      },
      error: null,
      extractedAt: '2026-08-20T00:00:00.000Z',
      futureBundleField: true,
    },
  }
}

test('bundle cache admits known structure while ignoring future fields', () => {
  const decoded = decodeBundleCacheEntry(entry())

  expect(decoded).toMatchObject({
    version: 6,
    key: 'cache-key',
    bundle: { domainId: 'notes', schemaMode: 'canonical-preview' },
  })
  expect(decoded && 'futureEntryField' in decoded).toBe(false)
  expect(decoded && 'futureBundleField' in decoded.bundle).toBe(false)
})

function canonicalEntry(): Record<string, unknown> {
  const value = entry()
  const bundle = value.bundle as Record<string, unknown>
  bundle.schemaMode = 'canonical-admitted'
  bundle.schemaRevision = `sha256:${'a'.repeat(64)}`
  bundle.ir = {
    format: 'astrale.dsl',
    version: 'v1',
    domain: 'notes.example.dev',
    classes: {},
    importsByKey: {},
    importedClassesByKey: {},
    functions: {},
    views: {},
    policies: {},
    dependencies: [],
    core: {},
  }
  bundle.schemaRoot = {
    format: 'astrale.dsl',
    version: 'v1',
    origin: 'notes.example.dev',
  }
  return value
}

test('canonical-admitted cache entries require their root and a valid revision', () => {
  expect(decodeBundleCacheEntry(canonicalEntry())).toBeDefined()

  const missingRoot = canonicalEntry()
  delete (missingRoot.bundle as Record<string, unknown>).schemaRoot
  expect(decodeBundleCacheEntry(missingRoot)).toBeUndefined()

  const invalidRoot = canonicalEntry()
  const invalidRootBundle = invalidRoot.bundle as Record<string, unknown>
  invalidRootBundle.schemaRoot = { canonical: true }
  expect(decodeBundleCacheEntry(invalidRoot)).toBeUndefined()

  const missingRevision = canonicalEntry()
  delete (missingRevision.bundle as Record<string, unknown>).schemaRevision
  expect(decodeBundleCacheEntry(missingRevision)).toBeUndefined()

  const invalidRevision = canonicalEntry()
  const invalidRevisionBundle = invalidRevision.bundle as Record<string, unknown>
  invalidRevisionBundle.schemaRevision = 'sha256:not-a-revision'
  expect(decodeBundleCacheEntry(invalidRevision)).toBeUndefined()
})

test('bundle cache rejects corrupt nested business shapes', () => {
  const corruptIr = entry()
  const bundle = corruptIr.bundle as Record<string, unknown>
  const ir = bundle.ir as Record<string, unknown>
  ir.classes = { Broken: null }
  expect(decodeBundleCacheEntry(corruptIr)).toBeUndefined()

  const corruptOverlay = entry()
  const secondBundle = corruptOverlay.bundle as Record<string, unknown>
  const overlay = secondBundle.overlay as Record<string, unknown>
  overlay.handlerLinks = [{ owner: 'Thing' }]
  expect(decodeBundleCacheEntry(corruptOverlay)).toBeUndefined()
})

function failed(extractedAt: string): StudioSchemaBundle {
  return {
    domainId: 'notes',
    renderFingerprint: 'sha-none',
    schemaMode: 'unavailable',
    extractedBy: 'static-tsmorph-fallback',
    depsInstalled: true,
    ir: null,
    overlay: { handlerLinks: [], sourceSpans: {} },
    error: { message: 'extractor produced no output' },
    extractedAt,
  }
}

test('a bundle that extracted keeps standing, whatever its age', () => {
  const bundle = { ...failed('1999-01-01T00:00:00.000Z'), error: null }
  expect(stillStands(bundle)).toBe(true)
})

test('a failed bundle stands briefly, then asks to be retried', () => {
  expect(stillStands(failed(new Date().toISOString()))).toBe(true)
  expect(stillStands(failed(new Date(Date.now() - 5 * 60_000).toISOString()))).toBe(false)
})

test('a failed bundle with no readable timestamp is retried rather than trusted', () => {
  expect(stillStands(failed('not a date'))).toBe(false)
})

function temporaryDomain(): { id: string; root: string; schemaIndex: string } {
  const root = mkdtempSync(join(tmpdir(), 'studio-anatomy-cache-'))
  roots.push(root)
  const schemaIndex = join(root, 'schema/index.ts')
  mkdirSync(join(root, 'schema'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
  writeFileSync(
    join(root, 'application.ts'),
    `import { defineApplication } from '@astrale-os/sdk/application'
import { schema } from './schema/index.js'
export const application = defineApplication({ schema, runtime: {} as never })
`,
  )
  writeFileSync(
    schemaIndex,
    `throw new Error('temporary extraction failure')
export const schema = {}
`,
  )
  const sdk = realpathSync(join(import.meta.dir, '../../node_modules/@astrale-os/sdk'))
  const scope = join(root, 'node_modules', '@astrale-os')
  mkdirSync(scope, { recursive: true })
  symlinkSync(sdk, join(scope, 'sdk'), 'dir')
  const handle = registerDomain(root)
  if (!handle) throw new Error('temporary cache domain was not registered')
  domainIds.push(handle.id)
  return { id: handle.id, root, schemaIndex }
}

test('anatomy follows a bundle that heals after a temporary extraction failure', async () => {
  const domain = temporaryDomain()
  expect((await getAnatomy(domain.id))?.views).toEqual([])

  const failedBundle = await getBundle(domain.id)
  if (!failedBundle) throw new Error('temporary cache domain has no bundle')
  expect(failedBundle.error?.message).toContain('temporary extraction failure')

  // Expire the in-memory failure and change the source so the persisted failed
  // bundle has a different key. Both reads below must then join the same retry.
  failedBundle.extractedAt = new Date(Date.now() - 5 * 60_000).toISOString()
  writeFileSync(
    domain.schemaIndex,
    `import { defineSchema, view } from '@astrale-os/sdk/schema'
export const schema = defineSchema('anatomy-cache.studio.test', {
  views: { application: view({ target: 'domain' }) },
})
`,
  )

  const [bundle, anatomy] = await Promise.all([getBundle(domain.id), getAnatomy(domain.id)])
  expect(bundle?.error).toBeNull()
  expect(bundle?.ir?.views).toHaveProperty('application')
  expect(anatomy?.views).toContainEqual(expect.objectContaining({ slug: 'application' }))
}, 30_000)
