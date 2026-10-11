import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StudioSchemaBundle } from '../../shared/contracts/schema'

import { registerDomain, unregisterDomain } from '../domain/registry'
import { readState, writeJson } from '../state/store'
import { decodeBundleCacheEntry, getAnatomy, getBundle, invalidate, stillStands } from './cache'

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

function entry(mutate: (bundle: Record<string, any>) => void = () => {}): Record<string, unknown> {
  const ir = {
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
  const bundle: Record<string, any> = {
    domainId: 'notes',
    renderFingerprint: 'render-hash',
    schemaMode: 'canonical-admitted',
    schemaRevision: `sha256:${'a'.repeat(64)}`,
    extractedBy: 'runtime-bun',
    depsInstalled: true,
    ir,
    overlay: { handlerLinks: [], sourceSpans: {} },
    schemaRoot: { format: 'astrale.dsl', version: 'v1', origin: 'notes.example.dev' },
    error: null,
    extractedAt: '2026-08-20T00:00:00.000Z',
    futureBundleField: true,
  }
  mutate(bundle)
  return { version: 6, key: 'cache-key', futureEntryField: true, bundle }
}

test('a persisted bundle is admitted by its known structure, and refused when corrupt', () => {
  const decoded = decodeBundleCacheEntry(entry())
  expect(decoded).toMatchObject({ version: 6, key: 'cache-key', bundle: { domainId: 'notes' } })
  expect(decoded && 'futureEntryField' in decoded).toBe(false)
  expect(decoded && 'futureBundleField' in decoded.bundle).toBe(false)

  for (const corrupt of [
    (bundle: Record<string, any>) => delete bundle.schemaRoot,
    (bundle: Record<string, any>) => (bundle.schemaRoot = { canonical: true }),
    (bundle: Record<string, any>) => delete bundle.schemaRevision,
    (bundle: Record<string, any>) => (bundle.schemaRevision = 'sha256:not-a-revision'),
    (bundle: Record<string, any>) => (bundle.ir.classes = { Broken: null }),
    (bundle: Record<string, any>) => (bundle.overlay.handlerLinks = [{ owner: 'Thing' }]),
  ])
    expect(decodeBundleCacheEntry(entry(corrupt))).toBeUndefined()
})

test('a failed bundle stands briefly, then asks to be retried; a good one stands for good', () => {
  const failed = (extractedAt: string, error: StudioSchemaBundle['error'] = { message: 'x' }) =>
    ({
      domainId: 'notes',
      renderFingerprint: 'sha-none',
      schemaMode: 'unavailable',
      extractedBy: 'static-tsmorph-fallback',
      depsInstalled: true,
      ir: null,
      overlay: { handlerLinks: [], sourceSpans: {} },
      error,
      extractedAt,
    }) satisfies StudioSchemaBundle
  expect(stillStands(failed('1999-01-01T00:00:00.000Z', null))).toBe(true)
  expect(stillStands(failed(new Date().toISOString()))).toBe(true)
  expect(stillStands(failed(new Date(Date.now() - 5 * 60_000).toISOString()))).toBe(false)
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
  const sdk = realpathSync(join(import.meta.dir, '../../../node_modules/@astrale-os/sdk'))
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
const dependency = defineSchema('cache-dependency.studio.test', { name: 'Test Domain', classes: { Shared } })
export const schema = defineSchema('cache-upgrade.studio.test', { name: 'Test Domain',
  dependencies: { dependency },
  classes: { Document: nodeClass({ icon: classIcon.neutral, extends: [Shared] }) },
})
`,
  )
  const imported = (bundle: StudioSchemaBundle | null) =>
    bundle?.ir?.importsByKey?.['cache-dependency.studio.test:class.Shared']
  expect(imported(await getBundle(domain.id))).toBeDefined()
  const cacheFile = '.cache/schema-bundle.json'
  const persisted = JSON.parse(readState(domain.root, cacheFile)!)
  // the current key on purpose: a standalone binary cannot hash tool sources, so the
  // entry version alone must retire even a successful preview of an older generation
  writeJson(domain.root, cacheFile, {
    ...persisted,
    version: 9,
    bundle: {
      ...persisted.bundle,
      schemaMode: 'canonical-preview',
      schemaRevision: undefined,
      ir: { ...persisted.bundle.ir, importsByKey: {}, importedClassesByKey: {} },
    },
  })
  invalidate(domain.id, 'all')
  const upgraded = await getBundle(domain.id)
  expect(upgraded?.schemaMode).toBe('canonical-admitted')
  expect(imported(upgraded)).toBeDefined()

  // a current admitted disk cache is reused without another extraction
  const current = JSON.parse(readState(domain.root, cacheFile)!)
  current.bundle.extractedAt = '2000-01-01T00:00:00.000Z'
  writeJson(domain.root, cacheFile, current)
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
export const schema = defineSchema('anatomy-cache.studio.test', { name: 'Test Domain',
  views: { application: view({}) },
})
`,
  )

  const [bundle, anatomy] = await Promise.all([getBundle(domain.id), getAnatomy(domain.id)])
  expect(bundle?.error).toBeNull()
  expect(bundle?.ir?.views).toHaveProperty('application')
  expect(anatomy?.views).toContainEqual(expect.objectContaining({ slug: 'application' }))
}, 30_000)
