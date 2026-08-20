import { describe, expect, test } from 'bun:test'

import type { CanonicalDomainSchemaV1 } from './canonical-schema'

import {
  closureFromSdk,
  findCanonicalDomainSchemaExport,
  normalizeLegacySchemaIR,
  projectCanonicalCore,
  projectCanonicalSchema,
} from './canonical-schema'

const emptyProperties = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
}

const dependency = {
  format: 'astrale.dsl',
  version: 'v1',
  origin: 'directory.example.dev',
  dependencies: [],
  types: {},
  interfaces: {
    Named: {
      family: 'node',
      extends: [],
      properties: {
        ...emptyProperties,
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      propertyMetadata: {},
      methods: {},
    },
  },
  classes: {},
  functions: {},
  policies: {},
  views: {},
  core: { nodes: {}, edges: [] },
} satisfies CanonicalDomainSchemaV1

const namedRef = {
  origin: dependency.origin,
  kind: 'interface',
  name: 'Named',
} as const
const namedKey = `${dependency.origin}:interface.Named` as const
const documentRef = {
  origin: 'documents.example.dev',
  kind: 'class',
  name: 'Document',
} as const

const root = {
  format: 'astrale.dsl',
  version: 'v1',
  origin: 'documents.example.dev',
  dependencies: [{ origin: dependency.origin, revision: `sha256:${'1'.repeat(64)}` }],
  types: { State: { type: 'string', enum: ['draft', 'published'] } },
  interfaces: {
    Publishable: {
      family: 'node',
      extends: [namedRef],
      properties: emptyProperties,
      propertyMetadata: {},
      methods: {},
    },
  },
  classes: {
    Document: {
      family: 'node',
      implements: [{ origin: 'documents.example.dev', kind: 'interface', name: 'Publishable' }],
      properties: {
        ...emptyProperties,
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          note: { type: ['string', 'null'] },
        },
        required: ['title', 'note'],
      },
      propertyMetadata: {},
      data: { mediaType: 'application/json', indexed: true },
      methods: {
        watch: {
          input: {
            ...emptyProperties,
            properties: { cursor: { type: 'string' }, limit: { type: 'integer' } },
            required: ['cursor'],
          },
          output: { mode: 'stream', item: { type: 'string' } },
          auth: 'authorized',
          static: false,
          inheritance: 'default',
        },
      },
      policies: {},
    },
    references: {
      family: 'edge',
      implements: [],
      properties: emptyProperties,
      propertyMetadata: {},
      orientation: 'directed',
      endpoints: {
        source: { role: 'document', accepts: [documentRef], outgoing: '1..*' },
        target: { role: 'named', accepts: [namedRef], incoming: '0..1' },
      },
      policies: {},
      constraints: { noSelf: true },
    },
  },
  functions: {
    exportAll: {
      description: 'Export every document.',
      input: emptyProperties,
      output: { mode: 'binary' },
      auth: 'authenticated',
    },
  },
  policies: {},
  views: {
    editor: {
      description: 'Document editor',
      target: { kind: 'definition', definitions: [documentRef, namedRef] },
      auth: 'optional',
    },
  },
  core: {
    nodes: {
      welcome: {
        class: documentRef,
        properties: {
          'documents.example.dev:class.Document.property.title': 'Welcome',
        },
      },
    },
    edges: [
      {
        class: { origin: 'documents.example.dev', kind: 'class', name: 'references' },
        source: { origin: 'documents.example.dev', kind: 'core', name: 'welcome' },
        target: { kind: 'domain' },
        properties: { weight: 1 },
      },
    ],
  },
} satisfies CanonicalDomainSchemaV1

describe('canonical DomainSchema V1 projection', () => {
  test('admits only an SDK-verified, exact dependency closure', () => {
    expect(
      closureFromSdk({ bundle: { create: () => ({ root, closure: [dependency] }) } }, root),
    ).toEqual([dependency])

    expect(
      closureFromSdk(
        {
          bundle: { create: () => ({ root: dependency, closure: [dependency] }) },
          schema: { resolve: () => ({ $: { schema: root, closure: [dependency] } }) },
        },
        root,
      ),
    ).toEqual([dependency])

    expect(
      closureFromSdk({ bundle: { create: () => ({ root, closure: [root, dependency] }) } }, root),
    ).toEqual([])
  })

  test('finds any directly exported V1 root while preferring `schema`', () => {
    expect(findCanonicalDomainSchemaExport({ Other: dependency, schema: root })).toBe(root)
    expect(findCanonicalDomainSchemaExport({ Current: root })).toBe(root)
    expect(findCanonicalDomainSchemaExport({ schema: { kind: 'legacy' } })).toBeNull()
  })

  test('keeps legacy fields and enriches refs, callables, views, and imported interfaces', () => {
    const projected = projectCanonicalSchema(root, [dependency])
    const ir = projected.ir

    expect(ir).toMatchObject({
      format: 'astrale.dsl',
      version: 'v1',
      domain: root.origin,
      dependencies: root.dependencies,
    })
    expect(ir.interfaces.Publishable.extends).toEqual(['Named'])
    expect(ir.interfaces.Publishable.extendsRefs).toEqual([namedRef])
    expect(ir.imports.Named).toEqual({
      origin: dependency.origin,
      definition: 'interface',
      ref: namedRef,
      key: namedKey,
    })
    expect(ir.importsByKey?.[namedKey]).toEqual(ir.imports.Named)
    expect(ir.importedInterfacesByKey?.[namedKey]).toMatchObject({
      name: 'Named',
      origin: dependency.origin,
    })
    expect(projected.importedInterfaces.Named).toMatchObject({
      name: 'Named',
      origin: dependency.origin,
      family: 'node',
      properties: { name: { type: 'string' } },
      required: ['name'],
    })

    expect(ir.classes.Document.properties).toEqual({
      title: { type: 'string' },
      summary: { type: 'string' },
      note: { type: ['string', 'null'] },
    })
    expect(ir.classes.Document.required).toEqual(['title', 'note'])
    expect(ir.classes.Document.data).toEqual({ mediaType: 'application/json', indexed: true })
    expect(ir.classes.Document.methods.watch).toMatchObject({
      name: 'watch',
      auth: 'authorized',
      static: false,
      inheritance: 'default',
      params: {
        cursor: { type: 'string' },
        limit: { type: 'integer' },
      },
      requiredParams: ['cursor'],
      output: { mode: 'stream', item: { type: 'string' } },
      returns: { type: 'string' },
    })
    expect(ir.classes.references.endpoints).toEqual([
      {
        name: 'document',
        types: ['Document'],
        refs: [documentRef],
        cardinality: { min: 1, max: null },
      },
      {
        name: 'named',
        types: ['Named'],
        refs: [namedRef],
        cardinality: { min: 0, max: 1 },
      },
    ])
    expect(ir.functions.exportAll).toMatchObject({
      name: 'exportAll',
      auth: 'authenticated',
      static: true,
      inheritance: 'default',
      params: {},
      requiredParams: [],
      output: { mode: 'binary' },
      returns: {},
    })
    expect(ir.views?.editor).toEqual({
      name: 'editor',
      description: 'Document editor',
      target: { kind: 'definition', definitions: [documentRef, namedRef] },
      auth: 'optional',
    })
    expect(ir.core).toEqual(root.core)
  })

  test('keeps colliding imported definitions under exact DSL Keys only', () => {
    const alternate = {
      ...dependency,
      origin: 'people.example.dev',
    } satisfies CanonicalDomainSchemaV1
    const classOwner = {
      ...dependency,
      origin: 'catalog.example.dev',
      interfaces: {},
      classes: {
        Named: {
          family: 'node',
          implements: [],
          properties: emptyProperties,
          propertyMetadata: {},
          methods: {},
          policies: {},
        },
      },
    } satisfies CanonicalDomainSchemaV1
    const alternateRef = {
      origin: alternate.origin,
      kind: 'interface',
      name: 'Named',
    } as const
    const classRef = {
      origin: classOwner.origin,
      kind: 'class',
      name: 'Named',
    } as const
    const collisionRoot = {
      format: 'astrale.dsl',
      version: 'v1',
      origin: 'collisions.example.dev',
      dependencies: [],
      types: {},
      interfaces: {
        Local: {
          family: 'node',
          extends: [namedRef, alternateRef],
          properties: emptyProperties,
          propertyMetadata: {},
          methods: {},
        },
      },
      classes: {},
      functions: {},
      policies: {},
      views: {
        everything: {
          target: { kind: 'definition', definitions: [namedRef, alternateRef, classRef] },
          auth: 'required',
        },
      },
      core: { nodes: {}, edges: [] },
    } satisfies CanonicalDomainSchemaV1

    const projected = projectCanonicalSchema(collisionRoot, [dependency, alternate, classOwner])
    const keys = [
      'directory.example.dev:interface.Named',
      'people.example.dev:interface.Named',
      'catalog.example.dev:class.Named',
    ]

    expect(Object.keys(projected.ir.importsByKey ?? {}).sort()).toEqual(keys.sort())
    expect(Object.keys(projected.ir.importedInterfacesByKey ?? {}).sort()).toEqual(
      keys.filter((key) => key.includes(':interface.')).sort(),
    )
    expect(
      projected.ir.importedInterfacesByKey?.['directory.example.dev:interface.Named']?.origin,
    ).toBe('directory.example.dev')
    expect(
      projected.ir.importedInterfacesByKey?.['people.example.dev:interface.Named']?.origin,
    ).toBe('people.example.dev')
    expect(projected.ir.importsByKey?.['catalog.example.dev:class.Named']).toMatchObject({
      definition: 'class',
      key: 'catalog.example.dev:class.Named',
      ref: classRef,
    })
    expect(projected.ir.imports.Named).toBeUndefined()
    expect(projected.importedInterfaces.Named).toBeUndefined()
  })

  test('projects canonical core paths and the owning Domain endpoint', () => {
    expect(projectCanonicalCore(root)).toEqual({
      domain: root.origin,
      nodes: [
        {
          path: '/:documents.example.dev:core.welcome',
          className: 'Document',
          data: { 'documents.example.dev:class.Document.property.title': 'Welcome' },
        },
      ],
      edges: [
        {
          from: '/:documents.example.dev:core.welcome',
          to: '/:documents.example.dev',
          edgeName: 'references',
          data: { weight: 1 },
        },
      ],
    })
  })

  test('normalizes a legacy IR to the required standalone-function shape', () => {
    const ir = normalizeLegacySchemaIR({
      version: '1.0',
      domain: 'legacy.example.dev',
      types: {},
      interfaces: {},
      classes: {},
      imports: {},
      functions: {
        legacy: {
          params: {
            required: { type: 'string' },
            maybe: { type: ['string', 'null'] },
          },
          returns: { type: 'boolean' },
        },
      },
    })
    expect(ir.functions.legacy).toMatchObject({
      params: {
        required: { type: 'string' },
        maybe: { type: ['string', 'null'] },
      },
      requiredParams: ['required'],
      input: { required: ['required'] },
    })
  })
})
