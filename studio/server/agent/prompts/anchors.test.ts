import { describe, expect, test } from 'bun:test'

import type { SchemaIR } from '../../../shared/types'

import { describeAnchor } from './anchors'

const importedKey = 'directory.example.dev:class.Named' as const
const ir: SchemaIR = {
  format: 'astrale.dsl',
  version: 'v1',
  domain: 'example.dev',
  classes: {
    Item: {
      type: 'node',
      name: 'Item',
      origin: 'example.dev',
      ref: { origin: 'example.dev', kind: 'class', name: 'Item' },
      properties: { count: { type: 'integer' } },
      required: ['count'],
      methods: {},
    },
  },
  importsByKey: {
    [importedKey]: {
      origin: 'directory.example.dev',
      key: importedKey,
      ref: { origin: 'directory.example.dev', kind: 'class', name: 'Named' },
    },
  },
  importedClassesByKey: {
    [importedKey]: {
      type: 'node',
      name: 'Named',
      origin: 'directory.example.dev',
      ref: { origin: 'directory.example.dev', kind: 'class', name: 'Named' },
      properties: { label: { type: 'string' } },
      required: [],
      methods: {},
    },
  },
  functions: {
    inspect: {
      name: 'inspect',
      input: { type: 'object', properties: { cursor: { type: 'string' } }, required: [] },
      output: { mode: 'stream', item: { type: 'integer' } },
      auth: 'authenticated',
    },
  },
  views: {},
  policies: {},
  dependencies: [],
  core: {},
}

describe('anchor descriptions', () => {
  test('describes local and exact imported Class properties', () => {
    expect(describeAnchor('class.Item.property.count', ir, undefined)).toContain(
      '**Item.count** : int',
    )
    expect(describeAnchor(`class.${importedKey}.property.label`, ir, undefined)).toContain(
      '**Named.label** : string?',
    )
  })

  test('describes standalone Functions with output mode and authentication', () => {
    expect(describeAnchor('function.inspect', ir, undefined)).toContain(
      'stream<int> [authenticated]',
    )
  })
})
