import { describe, expect, test } from 'bun:test'

import type { SchemaIR } from '../../../shared/types'

import { describeAnchor } from './anchors'

const importedKey = 'directory.example.dev:interface.Named' as const

const ir: SchemaIR = {
  format: 'astrale.dsl',
  version: 'v1',
  domain: 'example.dev',
  types: {},
  interfaces: {},
  classes: {},
  imports: {},
  importsByKey: {
    [importedKey]: {
      origin: 'directory.example.dev',
      definition: 'interface',
      key: importedKey,
      ref: { origin: 'directory.example.dev', kind: 'interface', name: 'Named' },
    },
  },
  importedInterfacesByKey: {
    [importedKey]: {
      type: 'interface',
      name: 'Named',
      origin: 'directory.example.dev',
      ref: { origin: 'directory.example.dev', kind: 'interface', name: 'Named' },
      properties: { label: { type: 'string' } },
      required: [],
      methods: {},
    },
  },
  functions: {
    inspect: {
      name: 'inspect',
      input: {
        type: 'object',
        properties: { cursor: { type: 'string' } },
        required: [],
      },
      params: { cursor: { type: 'string' } },
      requiredParams: [],
      output: { mode: 'stream', item: { type: 'integer' } },
      returns: { type: 'integer' },
      static: true,
      inheritance: 'default',
      auth: 'authenticated',
    },
  },
}

describe('canonical anchor descriptions', () => {
  test('describes standalone Functions with exact input, output mode, and auth', () => {
    expect(describeAnchor('function.inspect', ir, undefined)).toContain(
      'inspect(cursor:string?)→stream<int> [static,authenticated]',
    )
  })

  test('resolves an imported interface member by its qualified identity', () => {
    expect(
      describeAnchor(
        'interface.directory.example.dev:interface.Named.property.label',
        ir,
        undefined,
      ),
    ).toBe('**Named.label** : string?')
    expect(
      describeAnchor('interface.directory.example.dev:interface.Named', ir, undefined),
    ).toContain('from directory.example.dev')
  })
})
