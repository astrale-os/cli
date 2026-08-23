import { describe, expect, test } from 'bun:test'

import {
  admitCanonicalSchemaFromSdk,
  closureFromSdk,
  findCanonicalDomainSchemaExport,
  isCanonicalDomainSchemaV1,
  projectCanonicalCore,
  projectCanonicalSchema,
  type CanonicalDomainSchemaV1,
} from './canonical-schema'

const localRef = { origin: 'docs.example.dev', kind: 'class', name: 'Document' } as const
const baseRef = { origin: 'shared.example.dev', kind: 'class', name: 'Named' } as const
const edgeRef = { origin: 'docs.example.dev', kind: 'class', name: 'links' } as const

const dependency = {
  format: 'astrale.dsl',
  version: 'v1',
  origin: 'shared.example.dev',
  classes: {
    Named: {
      kind: 'node',
      properties: { title: { schema: { type: 'string' }, required: true } },
      methods: {},
    },
  },
} satisfies CanonicalDomainSchemaV1

const root = {
  format: 'astrale.dsl',
  version: 'v1',
  origin: 'docs.example.dev',
  dependencies: [{ origin: dependency.origin, revision: `sha256:${'1'.repeat(64)}` }],
  classes: {
    Document: {
      kind: 'node',
      extends: [baseRef],
      properties: {
        slug: { schema: { type: 'string', minLength: 1 }, required: true },
      },
      methods: {
        rename: {
          input: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
          output: { mode: 'value', schema: { type: 'boolean' } },
          auth: 'authorized',
          static: false,
          inheritance: 'default',
        },
      },
    },
    links: {
      kind: 'edge',
      orientation: 'directed',
      endpoints: {
        source: { role: 'source', accepts: [localRef], outgoing: '1' },
        target: { role: 'target', accepts: [baseRef], incoming: '0..*' },
      },
      properties: {},
      methods: {},
    },
  },
  functions: {
    search: {
      input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      output: { mode: 'stream', item: { type: 'string' } },
      auth: 'authenticated',
    },
  },
  views: {
    documents: {
      target: { kind: 'definition', definitions: [localRef] },
      auth: 'optional',
    },
  },
  core: {
    nodes: {
      primary: { class: localRef, properties: { slug: 'primary' } },
    },
    edges: [
      {
        class: edgeRef,
        source: { origin: 'docs.example.dev', kind: 'core', name: 'primary' },
        target: { kind: 'domain', origin: 'docs.example.dev' },
      },
    ],
  },
} satisfies CanonicalDomainSchemaV1

describe('canonical Schema projection', () => {
  test('recognizes and selects only portable V1 schema roots', () => {
    expect(isCanonicalDomainSchemaV1(root)).toBe(true)
    expect(isCanonicalDomainSchemaV1({ ...root, version: 'v0' })).toBe(false)
    expect(findCanonicalDomainSchemaExport({ other: dependency, schema: root })).toBe(root)
  })

  test('projects Classes, exact inheritance/imports, callables, Views, and edges', () => {
    const { ir } = projectCanonicalSchema(root, [dependency])
    expect(ir.classes.Document).toMatchObject({
      extendsRefs: [baseRef],
      properties: { slug: { type: 'string', minLength: 1 } },
      required: ['slug'],
      methods: {
        rename: {
          input: { required: ['title'] },
          auth: 'authorized',
          output: { mode: 'value', schema: { type: 'boolean' } },
        },
      },
    })
    expect(ir.importsByKey['shared.example.dev:class.Named']).toEqual({
      origin: baseRef.origin,
      ref: baseRef,
      key: 'shared.example.dev:class.Named',
    })
    expect(ir.importedClassesByKey['shared.example.dev:class.Named']?.properties.title).toEqual({
      type: 'string',
    })
    expect(ir.classes.links.endpoints).toEqual([
      { name: 'source', types: ['Document'], refs: [localRef], cardinality: { min: 1, max: 1 } },
      { name: 'target', types: ['Named'], refs: [baseRef], cardinality: { min: 0, max: null } },
    ])
    expect(ir.functions.search).toMatchObject({ auth: 'authenticated', output: { mode: 'stream' } })
    expect(ir.views?.documents.target).toEqual({ kind: 'definition', definitions: [localRef] })
  })

  test('projects canonical Core coordinates without importing Application or Runtime', () => {
    expect(projectCanonicalCore(root)).toEqual({
      domain: root.origin,
      nodes: [
        {
          path: '/:docs.example.dev:core.primary',
          className: 'Document',
          data: { slug: 'primary' },
        },
      ],
      edges: [
        {
          from: '/:docs.example.dev:core.primary',
          to: '/:docs.example.dev',
          edgeName: 'links',
        },
      ],
    })
  })

  test('uses the authored SDK for closure, admission, revision, and resolved-source proof', () => {
    const accepted = { ...root }
    const revision = `sha256:${'a'.repeat(64)}` as const
    const sdk = {
      bundle: { create: () => ({ root: accepted, closure: [dependency] }) },
      schema: {
        accept: (candidate: unknown) => candidate,
        revision: () => revision,
        resolve: (candidate: unknown) => ({ source: candidate, origin: root.origin }),
      },
    }
    expect(closureFromSdk(sdk, accepted)).toEqual([dependency])
    expect(admitCanonicalSchemaFromSdk(sdk, accepted)).toEqual({
      status: 'admitted',
      root: accepted,
      closure: [dependency],
      revision,
    })
  })

  test('fails to preview when the SDK cannot prove admission', () => {
    expect(admitCanonicalSchemaFromSdk({}, root)).toEqual({
      status: 'preview',
      root,
      closure: [],
      revision: null,
    })
  })
})
