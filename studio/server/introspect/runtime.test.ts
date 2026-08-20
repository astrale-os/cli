import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DomainHandle } from '../domain'

import { buildBundle } from './bundle'
import { schemaHashOf } from './hash'
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
  defineSchema, domain, edge, edgeClass, fn, node, nodeClass,
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

  test('hashes the raw canonical root instead of the render projection', async () => {
    const handle = currentFixture()
    const extracted = await runtimeExtract(handle.schemaIndex, handle.root)
    expect(extracted.ok).toBe(true)

    const bundle = await buildBundle(handle)
    expect(bundle.schemaRoot).toEqual(extracted.root)
    expect(bundle.schemaHash).toBe(schemaHashOf(extracted.root))
    expect(bundle.schemaHash).not.toBe(schemaHashOf(extracted.ir))
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
