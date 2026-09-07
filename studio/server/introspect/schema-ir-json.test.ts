import { expect, test } from 'bun:test'

import { decodeSchemaIR } from './schema-ir-json'

function canonicalIr() {
  return {
    format: 'astrale.dsl',
    version: 'v1',
    domain: 'example.test',
    classes: {
      Document: {
        type: 'node',
        name: 'Document',
        origin: 'example.test',
        ref: { origin: 'example.test', kind: 'class', name: 'Document' },
        properties: {},
        methods: {
          rename: {
            name: 'rename',
            input: { type: 'object', properties: {} },
            output: { mode: 'value', schema: { type: 'boolean' } },
            static: false,
            abstract: false,
            auth: 'authorized',
          },
        },
      },
    },
    importsByKey: {},
    importedClassesByKey: {},
    functions: {
      search: {
        name: 'search',
        input: { type: 'object', properties: {} },
        output: { mode: 'stream', item: { type: 'string' } },
        auth: 'authenticated',
      },
    },
    views: {
      documents: {
        name: 'documents',
        target: { kind: 'domain' },
      },
    },
    policies: {},
    dependencies: [],
    core: {},
  }
}

test('admits the complete canonical Studio projection', () => {
  expect(decodeSchemaIR(canonicalIr())).toMatchObject({
    format: 'astrale.dsl',
    domain: 'example.test',
  })
})

test('rejects stale projections that lost canonical callable contracts', () => {
  const input = canonicalIr()
  const rename = input.classes.Document.methods.rename as Record<string, unknown>
  delete rename.input
  delete rename.output
  Object.assign(rename, { params: {}, returns: { type: 'boolean' } })
  expect(decodeSchemaIR(input)).toBeUndefined()
})

test('rejects projections that retain retired View auth metadata', () => {
  const input = canonicalIr()
  Object.assign(input.views.documents, { auth: 'required' })
  expect(decodeSchemaIR(input)).toBeUndefined()
})

test('rejects unversioned and incomplete projection roots', () => {
  const withoutFormat = canonicalIr() as Record<string, unknown>
  delete withoutFormat.format
  expect(decodeSchemaIR(withoutFormat)).toBeUndefined()

  const withoutViews = canonicalIr() as Record<string, unknown>
  delete withoutViews.views
  expect(decodeSchemaIR(withoutViews)).toBeUndefined()
})

test('requires the current boolean Method contract and rejects the removed field', () => {
  const input = canonicalIr()
  const method = input.classes.Document.methods.rename as Record<string, unknown>
  Object.assign(method, { inheritance: 'default' })
  expect(decodeSchemaIR(input)).toBeUndefined()
  delete method.inheritance
  delete method.abstract
  expect(decodeSchemaIR(input)).toBeUndefined()
})
