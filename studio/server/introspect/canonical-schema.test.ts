import * as sdk from '@astrale-os/sdk/schema'
import {
  core,
  defineSchema,
  edgeClass,
  func,
  method,
  nodeClass,
  output,
  property,
  valueSchema,
  view,
} from '@astrale-os/sdk/schema'
import { describe, expect, test } from 'bun:test'

import {
  extractCanonicalSchemaFromSdk,
  findCanonicalDomainSchemaExport,
  isCanonicalDomainSchemaV1,
  projectCanonicalCore,
  type CanonicalDomainSchemaV1,
} from './canonical-schema'

const string = valueSchema<string>()({ type: 'string' })
const boolean = valueSchema<boolean>()({ type: 'boolean' })
const rename = method({
  input: valueSchema<{ title: string }>()({
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
    additionalProperties: false,
  }),
  output: boolean,
  auth: 'authorized',
})

const Named = nodeClass({ properties: { title: string } })
const dependency = defineSchema('shared.example.dev', { classes: { Named } })
const Document = nodeClass({
  description: 'A document.',
  icon: '<svg />',
  extends: [Named],
  properties: { slug: property(string, { description: 'Stable slug.' }) },
  methods: { rename },
})
const links = edgeClass.directed({
  source: { as: 'source', accepts: [Document], outgoing: '1' },
  target: { as: 'target', accepts: [Named], incoming: '0..*' },
})
const primary = core.node(Document, { slug: 'primary', title: 'Primary' })
const primaryLink = core.edge(primary, links, primary, {})
const schema = defineSchema('docs.example.dev', {
  dependencies: { shared: dependency },
  classes: { Document, links },
  functions: {
    search: func({ input: string, output: output.stream(string), auth: 'authenticated' }),
  },
  views: { documents: view({ target: Document }) },
  core: { nodes: { primary }, edges: [primaryLink] },
})
const namedRef = { origin: dependency.origin, kind: 'class', name: 'Named' } as const
const documentRef = { origin: schema.origin, kind: 'class', name: 'Document' } as const

const sdkModule = sdk

describe('canonical Schema projection', () => {
  test('recognizes exported V1 roots and preserves an invalid root as a preview', () => {
    expect(isCanonicalDomainSchemaV1(schema)).toBe(true)
    expect(findCanonicalDomainSchemaExport({ other: dependency, schema })).toBe(schema)

    const invalid = {
      format: 'astrale.dsl',
      version: 'v1',
      origin: 'not an origin',
      dependencies: {},
      classes: {},
      functions: {},
      policies: {},
      views: {},
      core: { nodes: {}, edges: [] },
    } as CanonicalDomainSchemaV1
    expect(extractCanonicalSchemaFromSdk(sdkModule, invalid)).toMatchObject({
      status: 'preview',
      revision: null,
      ir: { domain: 'not an origin' },
    })
  })

  test('uses the resolved Domain for Classes, dependency footprint, callables, and Views', () => {
    const extraction = extractCanonicalSchemaFromSdk(sdkModule, schema)
    expect(extraction.status).toBe('admitted')
    expect(extraction.revision).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(extraction.ir.classes.Document).toMatchObject({
      icon: '<svg />',
      extendsRefs: [namedRef],
      properties: { slug: { type: 'string' } },
      required: ['slug'],
      propertyMetadata: {
        slug: { required: true, description: 'Stable slug.' },
      },
      methods: {
        rename: {
          input: { required: ['title'] },
          auth: 'authorized',
          output: { mode: 'value', schema: { type: 'boolean' } },
        },
      },
    })
    expect(extraction.ir.importsByKey['shared.example.dev:class.Named']).toEqual({
      origin: namedRef.origin,
      ref: namedRef,
      key: 'shared.example.dev:class.Named',
    })
    expect(
      extraction.ir.importedClassesByKey['shared.example.dev:class.Named']?.properties.title,
    ).toEqual({ type: 'string' })
    expect(extraction.ir.classes.links.endpoints).toEqual([
      {
        name: 'source',
        types: ['Document'],
        refs: [documentRef],
        cardinality: { min: 1, max: 1 },
      },
      {
        name: 'target',
        types: ['Named'],
        refs: [namedRef],
        cardinality: { min: 0, max: null },
      },
    ])
    expect(extraction.ir.functions.search).toMatchObject({
      auth: 'authenticated',
      output: { mode: 'stream' },
    })
    expect(extraction.ir.views.documents.target).toEqual({
      kind: 'definition',
      definitions: [documentRef],
    })
    expect(extraction.ir.dependencies).toEqual([
      { origin: dependency.origin, revision: sdk.schema.revision(dependency) },
    ])
  })

  test('projects Core from the same admitted root without a second Schema import', () => {
    const extraction = extractCanonicalSchemaFromSdk(sdkModule, schema)
    expect(projectCanonicalCore(extraction.root)).toEqual({
      domain: schema.origin,
      nodes: [
        {
          path: '/:docs.example.dev:core.primary',
          className: 'Document',
          data: {
            'docs.example.dev:class.Document.property.slug': 'primary',
            'shared.example.dev:class.Named.property.title': 'Primary',
          },
        },
      ],
      edges: [
        {
          from: '/:docs.example.dev:core.primary',
          to: '/:docs.example.dev:core.primary',
          edgeName: 'links',
          data: {},
        },
      ],
    })
  })

  test('delegates admission, resolution, and dependency reachability to the DSL', () => {
    const calls: string[] = []
    const wrapped = {
      ...sdk,
      bundle: {
        ...sdk.bundle,
        create(value: typeof schema) {
          calls.push('bundle.create')
          return sdk.bundle.create(value)
        },
        accept(value: unknown) {
          calls.push('bundle.accept')
          return sdk.bundle.accept(value)
        },
      },
      schema: {
        ...sdk.schema,
        resolve(value: typeof schema) {
          calls.push('schema.resolve')
          return sdk.schema.resolve(value)
        },
        compareDependencyMeaning(source: typeof schema, target: typeof dependency) {
          calls.push('schema.compareDependencyMeaning')
          return sdk.schema.compareDependencyMeaning(source, target)
        },
      },
    } as unknown as typeof sdk

    expect(extractCanonicalSchemaFromSdk(wrapped, schema).status).toBe('admitted')
    expect(calls).toEqual([
      'bundle.create',
      'bundle.accept',
      'schema.resolve',
      'schema.compareDependencyMeaning',
    ])
  })
})
