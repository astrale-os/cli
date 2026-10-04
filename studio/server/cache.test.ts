import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StudioSchemaBundle } from '../shared/types'

import { decodeBundleCacheEntry, getAnatomy, getBundle, invalidate, stillStands } from './cache'
import { registerDomain, unregisterDomain } from './domain'
import { readState, writeJson } from './state/store'

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
  writeFileSync(
    join(root, 'astrale.config.ts'),
    `import { defineProject } from '@astrale-os/sdk/project'
import { cloudflare } from '@astrale-os/adapter-cloudflare'
import { domain } from './domain.js'
export default defineProject({ domain, environments: { development: { deployment: cloudflare({}) } } })
`,
  )
  writeFileSync(
    join(root, 'domain.ts'),
    `import { defineDomain } from '@astrale-os/sdk/domain'
import { schema } from './schema/index.js'
export const domain = defineDomain({ schema, runtime: {} as never })
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

test('an upgraded Studio rebuilds a persisted successful preview from the old admission generation', async () => {
  const domain = temporaryDomain()
  writeFileSync(
    domain.schemaIndex,
    `import { classIcon, defineSchema, nodeClass, valueSchema } from '@astrale-os/sdk/schema'
const Shared = nodeClass({ icon: classIcon.neutral, properties: { title: valueSchema<string>()({ type: 'string' }) } })
const dependency = defineSchema('cache-dependency.studio.test', { classes: { Shared } })
export const schema = defineSchema('cache-upgrade.studio.test', {
  dependencies: { dependency },
  classes: { Document: nodeClass({ icon: classIcon.neutral, extends: [Shared] }) },
})
`,
  )
  const original = await getBundle(domain.id)
  expect(original?.error).toBeNull()
  expect(original?.schemaMode).toBe('canonical-admitted')
  expect(original?.ir?.importsByKey?.['cache-dependency.studio.test:class.Shared']).toBeDefined()
  const persisted = JSON.parse(readState(domain.root, '.cache/schema-bundle.json')!)
  // Match the current key deliberately: a standalone binary cannot hash tool
  // sources, so the semantic generation must retire even a successful preview.
  writeJson(domain.root, '.cache/schema-bundle.json', {
    ...persisted,
    version: 9,
    bundle: {
      ...persisted.bundle,
      schemaMode: 'canonical-preview',
      schemaRevision: undefined,
      renderFingerprint: 'old-admission-preview',
      error: null,
      ir: { ...persisted.bundle.ir, importsByKey: {}, importedClassesByKey: {} },
    },
  })
  invalidate(domain.id, 'all')

  const upgraded = await getBundle(domain.id)
  expect(upgraded?.schemaMode).toBe('canonical-admitted')
  expect(upgraded?.renderFingerprint).not.toBe('old-admission-preview')
  expect(upgraded?.ir?.importsByKey?.['cache-dependency.studio.test:class.Shared']).toBeDefined()
  const current = JSON.parse(readState(domain.root, '.cache/schema-bundle.json')!)
  expect(current.version).toBeGreaterThan(9)

  // A current admitted disk cache remains reusable without another extraction.
  current.bundle.extractedAt = '2000-01-01T00:00:00.000Z'
  writeJson(domain.root, '.cache/schema-bundle.json', current)
  invalidate(domain.id, 'all')
  expect((await getBundle(domain.id))?.extractedAt).toBe(current.bundle.extractedAt)
}, 30_000)

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
