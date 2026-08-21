import { expect, test } from 'bun:test'

import { decodeBundleCacheEntry } from './cache'

function entry(): Record<string, unknown> {
  return {
    version: 4,
    key: 'cache-key',
    futureEntryField: { version: 5 },
    bundle: {
      domainId: 'notes',
      renderFingerprint: 'render-hash',
      schemaMode: 'legacy',
      extractedBy: 'runtime-bun',
      depsInstalled: true,
      ir: {
        version: 'legacy',
        domain: 'notes.example.dev',
        types: {},
        interfaces: {},
        classes: {},
        imports: {},
        functions: {},
      },
      overlay: {
        origin: 'notes.example.dev',
        requires: [],
        crossDomainImports: [],
        mixins: [],
        handlerLinks: [],
        sourceSpans: {},
        annotations: [],
      },
      importedInterfaces: {},
      error: null,
      extractedAt: '2026-08-20T00:00:00.000Z',
      futureBundleField: true,
    },
  }
}

test('bundle cache admits known structure while ignoring future fields', () => {
  const decoded = decodeBundleCacheEntry(entry())

  expect(decoded).toMatchObject({
    version: 4,
    key: 'cache-key',
    bundle: { domainId: 'notes', schemaMode: 'legacy' },
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
    types: {},
    interfaces: {},
    classes: {},
    imports: {},
    functions: {},
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
