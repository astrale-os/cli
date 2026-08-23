import { describe, expect, test } from 'bun:test'

import {
  classRefKey,
  isIrClassRef,
  isIrSchemaRef,
  parseClassRefKey,
  parseSchemaRefKey,
  schemaRefKey,
} from './identity'

describe('schema identity', () => {
  test('round-trips exact Class identity', () => {
    const ref = { origin: 'docs.example.dev', kind: 'class' as const, name: 'Document' }
    expect(classRefKey(ref)).toBe('docs.example.dev:class.Document')
    expect(parseClassRefKey(classRefKey(ref))).toEqual(ref)
    expect(isIrClassRef(ref)).toBe(true)
  })

  test('preserves all supported schema reference kinds', () => {
    const ref = { origin: 'docs.example.dev', kind: 'function' as const, name: 'search' }
    expect(schemaRefKey(ref)).toBe('docs.example.dev:function.search')
    expect(parseSchemaRefKey(schemaRefKey(ref))).toEqual(ref)
    expect(isIrSchemaRef(ref)).toBe(true)
  })

  test('rejects removed Interface coordinates and malformed keys', () => {
    expect(isIrSchemaRef({ origin: 'docs.example.dev', kind: 'interface', name: 'Named' })).toBe(
      false,
    )
    expect(parseSchemaRefKey('docs.example.dev:interface.Named')).toBeUndefined()
    expect(parseClassRefKey('docs.example.dev:function.search')).toBeUndefined()
  })
})
