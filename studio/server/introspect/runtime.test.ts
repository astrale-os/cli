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
  return root
}

function linkCurrentSdk(root: string): void {
  const sdk = realpathSync(join(import.meta.dir, '../../../node_modules/@astrale-os/sdk'))
  const scope = join(root, 'node_modules', '@astrale-os')
  mkdirSync(scope, { recursive: true })
  symlinkSync(sdk, join(scope, 'sdk'), 'dir')
}

function currentFixture(): DomainHandle {
  const root = fixtureRoot('canonical-runtime')
  linkCurrentSdk(root)
  const schemaIndex = join(root, 'schema', 'index.ts')
  const domainFile = join(root, 'implementation.ts')
  writeFileSync(
    schemaIndex,
    `
import {
  bundle, defineSchema, domain, edge, edgeClass, fn, node, nodeClass,
  nodeInterface, output, property, view,
} from '@astrale-os/sdk/schema'

const Named = nodeInterface()
export const Directory = defineSchema('directory.runtime.test', {
  interfaces: { Named },
})

const rename = fn({
  input: {
    type: 'object', properties: { title: { type: 'string' } },
    required: ['title'], additionalProperties: false,
  },
  output: { type: 'boolean' },
  auth: 'authenticated',
})
const Document = nodeClass({
  implements: [Named],
  properties: { title: property({ type: 'string' }, { required: true }) },
  methods: { rename },
})
const owned_by = edgeClass.directed({
  source: { as: 'document', accepts: [Document], outgoing: '0..*' },
  target: { as: 'owner', accepts: [Document], incoming: '0..*' },
})
const welcome = node(Document, { title: 'Welcome' })

export const schema = defineSchema('documents.runtime.test', {
  dependencies: [Directory],
  classes: { Document, owned_by },
  functions: {
    exportAll: fn({
      input: { type: 'object', properties: {}, required: [], additionalProperties: false },
      output: output.binary(),
      auth: 'authenticated',
    }),
  },
  views: { editor: view({ target: Document, auth: 'optional' }) },
  core: {
    nodes: { welcome },
    edges: [edge(welcome, owned_by, domain(), {})],
  },
})
export const installedBundle = bundle.create(schema)
`,
  )
  // Canonical core extraction must not import the effectful composition entry.
  writeFileSync(domainFile, `throw new Error('composition entry was imported')\n`)
  return {
    id: 'documents-runtime-test',
    root,
    configFile: join(root, 'astrale.config.ts'),
    domainFile,
    schemaDirName: 'schema',
    schemaDir: join(root, 'schema'),
    schemaIndex,
  }
}

describe('current SDK schema extractor', () => {
  test('resolves the domain SDK, returns its raw root, and projects current members', async () => {
    const handle = currentFixture()
    const result = await runtimeExtract(handle.schemaIndex, handle.root)

    expect(result.ok).toBe(true)
    expect(result.schemaMode).toBe('canonical-admitted')
    expect(result.revision).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.root).toMatchObject({
      format: 'astrale.dsl',
      version: 'v1',
      origin: 'documents.runtime.test',
    })
    expect(result.ir).toMatchObject({
      format: 'astrale.dsl',
      domain: 'documents.runtime.test',
      functions: {
        exportAll: {
          static: true,
          inheritance: 'default',
          output: { mode: 'binary' },
        },
      },
      views: {
        editor: {
          auth: 'optional',
          target: { kind: 'definition' },
        },
      },
    })
    expect(result.importedInterfaces?.Named).toMatchObject({
      name: 'Named',
      origin: 'directory.runtime.test',
    })
  })

  test('transports the DSL revision and fingerprints the root only for rendering', async () => {
    const handle = currentFixture()
    const extracted = await runtimeExtract(handle.schemaIndex, handle.root)
    expect(extracted.ok).toBe(true)
    if (extracted.revision === null) throw new Error('expected an admitted schema revision')

    const bundle = await buildBundle(handle)
    expect(bundle.schemaRoot).toEqual(extracted.root)
    expect(bundle.schemaMode).toBe('canonical-admitted')
    expect(bundle.schemaRevision).toBe(extracted.revision)
    expect(bundle.renderFingerprint).toBe(renderFingerprintOf(extracted.root))
    expect(bundle.renderFingerprint).not.toBe(renderFingerprintOf(extracted.ir))
  })

  test('re-admits installed Bundle JSON before comparing its DSL revision', async () => {
    const handle = currentFixture()
    const extracted = await runtimeExtract(handle.schemaIndex, handle.root)
    if (extracted.revision === null) throw new Error('expected an admitted local schema revision')
    const fixture = (await import(handle.schemaIndex)) as { installedBundle: unknown }
    const installedWire = JSON.parse(JSON.stringify(fixture.installedBundle))

    expect(await admittedBundleRevision(handle.root, installedWire)).toBe(extracted.revision)
  })

  test('renders a V1-shaped but unadmitted root only as a structural preview', async () => {
    const root = fixtureRoot('canonical-preview')
    linkCurrentSdk(root)
    const schemaIndex = join(root, 'schema', 'index.ts')
    writeFileSync(
      schemaIndex,
      `export const schema = {
        format: 'astrale.dsl', version: 'v1', origin: 'not an origin',
        dependencies: [], types: {}, interfaces: {}, classes: {}, functions: {},
        policies: {}, views: {}, core: { nodes: {}, edges: [] },
      }\n`,
    )

    const result = await runtimeExtract(schemaIndex, root)
    expect(result.ok).toBe(true)
    expect(result.schemaMode).toBe('canonical-preview')
    expect(result.revision).toBeNull()
    expect(result.root).toMatchObject({ format: 'astrale.dsl', version: 'v1' })
  })

  test('extracts canonical core without importing implementation.ts', async () => {
    const handle = currentFixture()
    const result = await coreExtract(handle.schemaIndex, handle.domainFile, handle.root)

    expect(result).toEqual({
      ok: true,
      core: {
        domain: 'documents.runtime.test',
        nodes: [
          {
            path: '/:documents.runtime.test:core.welcome',
            className: 'Document',
            data: { 'documents.runtime.test:class.Document.property.title': 'Welcome' },
          },
        ],
        edges: [
          {
            from: '/:documents.runtime.test:core.welcome',
            to: '/:documents.runtime.test',
            edgeName: 'owned_by',
            data: {},
          },
        ],
      },
    })
  })
})

test('runtime extractor preserves the legacy compiled-IR envelope', async () => {
  const root = fixtureRoot('legacy-runtime')
  const schemaIndex = join(root, 'schema', 'index.ts')
  writeFileSync(
    schemaIndex,
    `export const D = { $: { ir: {
      version: 'legacy', domain: 'legacy.runtime.test', types: {}, interfaces: {},
      classes: {}, imports: {}, functions: {},
    } } }\n`,
  )

  const result = await runtimeExtract(schemaIndex, root)
  expect(result).toMatchObject({
    ok: true,
    schemaMode: 'legacy',
    revision: null,
    root: null,
    ir: { domain: 'legacy.runtime.test', functions: {} },
  })
})

test('core extractor preserves the legacy defineCore fallback', async () => {
  const root = fixtureRoot('legacy-core')
  const schemaIndex = join(root, 'schema', 'index.ts')
  const domainFile = join(root, 'domain.ts')
  writeFileSync(schemaIndex, `export const schema = { domain: 'legacy.runtime.test' }\n`)
  writeFileSync(
    domainFile,
    `
const Item = { config: { name: 'Item' } }
const linked = { config: { name: 'linked' } }
const schema = { interfaces: {}, classes: { Item, linked }, imports: [] }
export const core = {
  domain: 'legacy.runtime.test', schema,
  __nodes: [
    { path: '/legacy/left', def: Item, data: { name: 'Left' } },
    { path: '/legacy/right', def: Item, data: { name: 'Right' } },
  ],
  __edges: [
    { from: '/legacy/left', to: '/legacy/right', edge: linked, data: { order: 1 } },
  ],
}
`,
  )

  expect(await coreExtract(schemaIndex, domainFile, root)).toEqual({
    ok: true,
    core: {
      domain: 'legacy.runtime.test',
      nodes: [
        { path: '/legacy/left', className: 'Item', data: { name: 'Left' } },
        { path: '/legacy/right', className: 'Item', data: { name: 'Right' } },
      ],
      edges: [
        {
          from: '/legacy/left',
          to: '/legacy/right',
          edgeName: 'linked',
          data: { order: 1 },
        },
      ],
    },
  })
})
