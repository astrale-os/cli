import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DomainHandle } from '../domain'

import { buildBundle } from './bundle'
import { renderFingerprintOf } from './hash'
import { admittedBundleRevision } from './revision'
import { coreExtract, runtimeExtract } from './runtime'

const roots: string[] = []
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fixtureRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `studio-${label}-`))
  roots.push(root)
  mkdirSync(join(root, 'schema'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
  const sdk = realpathSync(join(import.meta.dir, '../../../node_modules/@astrale-os/sdk'))
  const scope = join(root, 'node_modules', '@astrale-os')
  mkdirSync(scope, { recursive: true })
  symlinkSync(sdk, join(scope, 'sdk'), 'dir')
  return root
}

function currentFixture(): DomainHandle {
  const root = fixtureRoot('canonical-runtime')
  const schemaIndex = join(root, 'schema/index.ts')
  const applicationFile = join(root, 'application.ts')
  writeFileSync(
    schemaIndex,
    `
      import { bundle, core, defineSchema, nodeClass, view } from '@astrale-os/sdk/schema'
      const Named = nodeClass({ properties: {} })
      export const DirectorySchema = defineSchema('directory.runtime.test', {
        classes: { Named },
      })
      const Document = nodeClass({ extends: [Named], properties: {} })
      const welcome = core.node(Document, {})
      export const schema = defineSchema('documents.runtime.test', {
        dependencies: { directory: DirectorySchema },
        classes: { Document },
        views: { editor: view({ target: Document }) },
        core: { nodes: { welcome } },
      })
      export const installedBundle = bundle.create(schema)
    `,
  )
  writeFileSync(applicationFile, `throw new Error('Application entry was imported')\n`)
  return {
    id: 'documents-runtime-test',
    root,
    configFile: join(root, 'astrale.config.ts'),
    applicationFile,
    schemaDirName: 'schema',
    schemaDir: join(root, 'schema'),
    schemaIndex,
  }
}

describe('SDK V1 schema extractor', () => {
  test('uses the authored SDK for admission and projects exact imported Classes', async () => {
    const handle = currentFixture()
    const result = await runtimeExtract(handle.schemaIndex, handle.root)
    expect(result).toMatchObject({
      ok: true,
      schemaMode: 'canonical-admitted',
      root: {
        format: 'astrale.dsl',
        version: 'v1',
        origin: 'documents.runtime.test',
      },
      ir: {
        domain: 'documents.runtime.test',
        views: { editor: { target: { kind: 'definition' } } },
        importsByKey: {
          'directory.runtime.test:class.Named': {
            ref: { origin: 'directory.runtime.test', kind: 'class', name: 'Named' },
          },
        },
      },
    })
    expect(result.revision).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  test('transports the DSL revision while keeping render identity separate', async () => {
    const handle = currentFixture()
    const extracted = await runtimeExtract(handle.schemaIndex, handle.root)
    if (extracted.revision === null) throw new Error('expected an admitted Schema revision')
    const built = await buildBundle(handle)
    expect(built.schemaRoot).toEqual(extracted.root)
    expect(built.schemaRevision).toBe(extracted.revision)
    expect(built.renderFingerprint).toBe(renderFingerprintOf(extracted.root))
    expect(built.renderFingerprint).not.toBe(renderFingerprintOf(extracted.ir))
  })

  test('re-admits installed Bundle JSON before comparing its revision', async () => {
    const handle = currentFixture()
    const extracted = await runtimeExtract(handle.schemaIndex, handle.root)
    if (extracted.revision === null) throw new Error('expected an admitted Schema revision')
    const fixture = (await import(handle.schemaIndex)) as { installedBundle: unknown }
    const installedWire = JSON.parse(JSON.stringify(fixture.installedBundle))
    expect(await admittedBundleRevision(handle.root, installedWire)).toBe(extracted.revision)
  })

  test('renders a V1-shaped root as preview when SDK admission fails', async () => {
    const root = fixtureRoot('canonical-preview')
    const schemaIndex = join(root, 'schema/index.ts')
    writeFileSync(
      schemaIndex,
      `export const schema = {
        format: 'astrale.dsl', version: 'v1', origin: 'not an origin',
        dependencies: {}, classes: {}, functions: {}, policies: {}, views: {},
        core: { nodes: {}, edges: [] },
      }\n`,
    )
    expect(await runtimeExtract(schemaIndex, root)).toMatchObject({
      ok: true,
      schemaMode: 'canonical-preview',
      revision: null,
    })
  })

  test('extracts Core through the pure Schema entry without importing Application', async () => {
    const handle = currentFixture()
    expect(await coreExtract(handle.schemaIndex, handle.root)).toEqual({
      ok: true,
      core: {
        domain: 'documents.runtime.test',
        nodes: [
          {
            path: '/:documents.runtime.test:core.welcome',
            className: 'Document',
            data: {},
          },
        ],
        edges: [],
      },
    })
  })
})

test('rejects the removed compiled-IR compatibility envelope', async () => {
  const root = fixtureRoot('removed-runtime')
  const schemaIndex = join(root, 'schema/index.ts')
  writeFileSync(schemaIndex, `export const D = { $: { ir: { domain: 'legacy' } } }\n`)
  expect(await runtimeExtract(schemaIndex, root)).toMatchObject({
    ok: false,
    schemaMode: 'unavailable',
    revision: null,
  })
})
