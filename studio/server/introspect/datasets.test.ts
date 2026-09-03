import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DomainHandle } from '../domain'

import { analyzeProjectConfig } from '../domain'
import { buildBundle } from './bundle'
import { buildDatasets, decodeDatasetJson, projectDataset, runtimeExtractDataset } from './datasets'

const roots: string[] = []
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fixture(config: string): DomainHandle {
  const root = mkdtempSync(join(tmpdir(), 'studio-datasets-'))
  roots.push(root)
  mkdirSync(join(root, 'schema'), { recursive: true })
  mkdirSync(join(root, 'tests', 'datasets'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  const sdk = realpathSync(join(import.meta.dir, '../../../node_modules/@astrale-os/sdk'))
  const scope = join(root, 'node_modules', '@astrale-os')
  mkdirSync(scope, { recursive: true })
  symlinkSync(sdk, join(scope, 'sdk'), 'dir')
  writeFileSync(
    join(root, 'schema/index.ts'),
    `
      import { classIcon, defineSchema, edgeClass, nodeClass } from '@astrale-os/sdk/schema'
      export const Item = nodeClass({ icon: classIcon.neutral, properties: {} })
      export const contains = edgeClass.directed({
        source: { as: 'parent', accepts: [Item], outgoing: '0..*' },
        target: { as: 'child', accepts: [Item], incoming: '0..1' },
      })
      export const schema = defineSchema('datasets.studio.test', { classes: { Item, contains } })
    `,
  )
  writeFileSync(
    join(root, 'tests/datasets/demo.ts'),
    `
      import { defineDataset } from '@astrale-os/sdk/testing'
      import { schema } from '../../schema/index.ts'
      export default defineDataset(schema, {
        id: 'demo',
        title: 'Demo data',
        graph({ classes: { Item, contains }, node, edge }) {
          const parent = node(Item, { id: 'parent' })
          const child = node(Item)
          edge(contains, parent, child)
          return { parent }
        },
      })
    `,
  )
  writeFileSync(join(root, 'tests/datasets/broken.ts'), `export default { id: 'broken' }\n`)
  writeFileSync(join(root, 'application.ts'), `throw new Error('Application entry was imported')\n`)
  writeFileSync(join(root, 'astrale.config.ts'), config)
  return {
    id: 'datasets-studio-test',
    root,
    configFile: join(root, 'astrale.config.ts'),
    applicationFile: join(root, 'application.ts'),
    schemaDirName: 'schema',
    schemaDir: join(root, 'schema'),
    schemaIndex: join(root, 'schema/index.ts'),
  }
}

describe('Dataset references', () => {
  test('are read from defineProject in the configuration, in order, without executing it', () => {
    const handle = fixture(`
      import { deploy, runtime } from '@astrale-os/sdk/deployment'
      import { defineProject } from '@astrale-os/sdk/project'
      import { dataset as ref, tests } from '@astrale-os/sdk/testing'
      import { application } from './application.js'
      // dataset('./tests/datasets/commented.ts')
      const crowded = ref('./tests/datasets/crowded.ts')
      const resources = tests({
        datasets: [
          ref('./tests/datasets/demo.ts'),
          crowded,
          ref('./tests/datasets/demo.ts'),
          ref(process.env.DYNAMIC ?? './tests/datasets/dynamic.ts'),
        ],
      })
      export default defineProject({
        deployment: deploy({ application, entrypoint: runtime('./runtime.ts'), adapter: {} as never }),
        tests: resources,
      })
    `)
    expect(analyzeProjectConfig(handle.root).datasets).toEqual([
      './tests/datasets/demo.ts',
      './tests/datasets/crowded.ts',
    ])
    expect(
      analyzeProjectConfig(fixture(`export default deploy({ application })\n`).root).datasets,
    ).toEqual([])
  })
})

describe('Dataset envelope', () => {
  const envelope = {
    format: 'astrale.sdk.dataset',
    version: 1,
    id: 'demo',
    title: 'Demo data',
    domain: { origin: 'datasets.studio.test', revision: 'sha256:abc' },
    graph: {
      nodes: [
        { id: 'parent', class: 'datasets.studio.test:class.Item', props: {} },
        {
          id: 'peer',
          class: 'other.example:class.Peer',
          props: { 'other.example:class.Peer.property.name': 'x' },
        },
      ],
      edges: [
        {
          source: 'parent',
          target: 'peer',
          class: 'datasets.studio.test:class.contains',
          props: {},
        },
      ],
    },
    variables: { parent: { node: 'parent' }, all: { nodes: ['parent', 'peer'] } },
  }

  test('is decoded structurally and projected into the Core canvas shape', () => {
    const decoded = decodeDatasetJson(envelope)
    expect(decoded?.id).toBe('demo')
    expect(decoded?.variables).toEqual({ parent: ['parent'], all: ['parent', 'peer'] })
    const projected = projectDataset('./tests/datasets/demo.ts', decoded!, null)
    expect(projected).toEqual({
      status: 'ready',
      path: './tests/datasets/demo.ts',
      id: 'demo',
      title: 'Demo data',
      origin: 'datasets.studio.test',
      revision: 'sha256:abc',
      schemaMatch: false,
      nodes: [
        { path: 'parent', className: 'Item', data: {} },
        {
          path: 'peer',
          className: 'other.example:class.Peer',
          data: { 'other.example:class.Peer.property.name': 'x' },
        },
      ],
      edges: [{ from: 'parent', to: 'peer', edgeName: 'contains' }],
      variables: { parent: ['parent'], all: ['parent', 'peer'] },
    })
  })

  test('rejects envelopes that are not the SDK Dataset format', () => {
    expect(decodeDatasetJson({ ...envelope, version: 2 })).toBeUndefined()
    expect(
      decodeDatasetJson({ ...envelope, graph: { nodes: [{ id: 1 }], edges: [] } }),
    ).toBeUndefined()
    expect(decodeDatasetJson({ ...envelope, variables: { bad: {} } })).toBeUndefined()
    expect(decodeDatasetJson(null)).toBeUndefined()
  })
})

describe('Dataset extraction', () => {
  test('extracts every referenced Dataset through the domain SDK without touching the Application', async () => {
    const handle = fixture(
      `import { defineProject } from '@astrale-os/sdk/project'
      import { dataset, tests } from '@astrale-os/sdk/testing'
      export default defineProject({ deployment: {} as never, tests: tests({ datasets: [
        dataset('./tests/datasets/demo.ts'),
        dataset('./tests/datasets/broken.ts'),
        dataset('./tests/datasets/missing.ts'),
      ] }) })\n`,
    )
    const bundle = await buildBundle(handle)
    expect(bundle.schemaMode).toBe('canonical-admitted')

    const result = await buildDatasets(handle, bundle)
    expect(result.domainId).toBe(handle.id)
    expect(result.datasets.map((entry) => entry.status)).toEqual(['ready', 'failed', 'failed'])

    const [demo, broken, missing] = result.datasets
    expect(demo).toMatchObject({
      status: 'ready',
      path: './tests/datasets/demo.ts',
      id: 'demo',
      title: 'Demo data',
      origin: 'datasets.studio.test',
      revision: bundle.schemaRevision,
      schemaMatch: true,
      nodes: [
        { path: 'Item-1', className: 'Item', data: {} },
        { path: 'parent', className: 'Item', data: {} },
      ],
      edges: [{ from: 'parent', to: 'Item-1', edgeName: 'contains' }],
      variables: { parent: ['parent'] },
    })
    expect(broken).toMatchObject({ status: 'failed', path: './tests/datasets/broken.ts' })
    expect((broken as { error: { message: string } }).error.message).toContain(
      'not an admitted Dataset',
    )
    expect(missing).toMatchObject({ status: 'failed', path: './tests/datasets/missing.ts' })
    expect((missing as { error: { message: string } }).error.message).toContain('not found')
  }, 120_000)

  test('reports a Dataset module whose default export is not a Dataset as data, never a crash', async () => {
    const handle = fixture(`export default {}\n`)
    const result = await runtimeExtractDataset(
      join(handle.root, 'tests/datasets/broken.ts'),
      handle.root,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('not an admitted Dataset')
    expect(await buildDatasets(handle, null)).toMatchObject({ domainId: handle.id, datasets: [] })
  }, 120_000)
})
