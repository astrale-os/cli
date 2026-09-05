import { expect, test } from 'bun:test'

import type { StudioSchemaBundle } from '../../shared/types'

import { schemaRefs } from './schema-refs'

test('enumerates local and exact imported Class anchors without collapsing homonyms', () => {
  const method = {
    name: 'rename',
    params: {},
    returns: {},
    static: false,
    abstract: false as const,
  }
  const bundle = {
    ir: {
      version: 'v1',
      domain: 'root.example.dev',
      classes: {
        Document: {
          type: 'node',
          name: 'Document',
          properties: { title: { type: 'string' } },
          methods: { rename: method },
        },
      },
      functions: {},
      importsByKey: {},
      importedClassesByKey: {
        'directory.example.dev:class.Named': {
          type: 'node',
          name: 'Named',
          properties: { directoryName: { type: 'string' } },
          methods: {},
        },
        'people.example.dev:class.Named': {
          type: 'node',
          name: 'Named',
          properties: {},
          methods: { rename: method },
        },
      },
    },
  } as unknown as StudioSchemaBundle

  expect(schemaRefs(bundle)).toEqual([
    'class.Document',
    'class.Document.property.title',
    'class.Document.method.rename',
    'class.directory.example.dev:class.Named',
    'class.directory.example.dev:class.Named.property.directoryName',
    'class.people.example.dev:class.Named',
    'class.people.example.dev:class.Named.method.rename',
  ])
})
