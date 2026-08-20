import { describe, expect, test } from 'bun:test'

import type { IrInterface, StudioSchemaBundle } from '../../shared/types'

import { schemaRefs } from './schema-refs'

function importedInterface(
  name: string,
  origin: string,
  properties: string[] = [],
  methods: string[] = [],
): IrInterface {
  return {
    type: 'interface',
    name,
    origin,
    ref: { origin, kind: 'interface', name },
    properties: Object.fromEntries(properties.map((property) => [property, { type: 'string' }])),
    methods: Object.fromEntries(
      methods.map((method) => [
        method,
        {
          name: method,
          params: {},
          returns: {},
          static: false,
          inheritance: 'default',
        },
      ]),
    ),
  }
}

function bundleWithImports(
  exact: NonNullable<StudioSchemaBundle['ir']>['importedInterfacesByKey'],
  legacy: Record<string, IrInterface>,
): StudioSchemaBundle {
  return {
    ir: {
      domain: 'root.example.dev',
      interfaces: {},
      classes: {},
      functions: {},
      ...(exact === undefined ? {} : { importedInterfacesByKey: exact }),
    },
    importedInterfaces: legacy,
  } as unknown as StudioSchemaBundle
}

describe('schema refs for imported interfaces', () => {
  test('enumerates every exact homonym without selecting a name-keyed winner', () => {
    const refs = schemaRefs(
      bundleWithImports(
        {
          'directory.example.dev:interface.Named': importedInterface(
            'Named',
            'directory.example.dev',
            ['directoryName'],
          ),
          'people.example.dev:interface.Named': importedInterface(
            'Named',
            'people.example.dev',
            [],
            ['rename'],
          ),
        },
        {
          Named: importedInterface('Named', 'legacy.invalid', ['legacyOnly']),
        },
      ),
    )

    expect(refs).toContain('interface.directory.example.dev:interface.Named')
    expect(refs).toContain('interface.directory.example.dev:interface.Named.property.directoryName')
    expect(refs).toContain('interface.people.example.dev:interface.Named.method.rename')
    expect(refs).not.toContain('interface.Named')
    expect(refs).not.toContain('interface.Named.property.legacyOnly')
  })

  test('uses the name-keyed imported interface only when the exact index is absent', () => {
    expect(
      schemaRefs(
        bundleWithImports(undefined, {
          Named: importedInterface('Named', 'legacy.example.dev', ['name']),
        }),
      ),
    ).toEqual(['interface.Named', 'interface.Named.property.name'])

    expect(
      schemaRefs(
        bundleWithImports(
          {},
          {
            Named: importedInterface('Named', 'legacy.example.dev', ['name']),
          },
        ),
      ),
    ).toEqual([])
  })
})
