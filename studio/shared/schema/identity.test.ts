import { describe, expect, test } from 'bun:test'

import {
  IR_SCHEMA_REF_KINDS,
  definitionRefKey,
  isIrDefinitionRef,
  isIrInterfaceRef,
  isIrSchemaRef,
  parseDefinitionRefKey,
  parseSchemaRefKey,
  schemaRefKey,
  type IrSchemaRef,
} from './identity'

describe('canonical schema identity', () => {
  test('round-trips every structural reference kind without short-name aliases', () => {
    for (const kind of IR_SCHEMA_REF_KINDS) {
      const ref = {
        origin: 'directory.example.dev',
        kind,
        name: '$Named_member',
      } satisfies IrSchemaRef
      expect(parseSchemaRefKey(schemaRefKey(ref))).toEqual(ref)
    }
  })

  test('keeps class and interface identities distinct', () => {
    const classRef = { origin: 'contracts.example.dev', kind: 'class', name: 'Shared' } as const
    const interfaceRef = {
      origin: 'contracts.example.dev',
      kind: 'interface',
      name: 'Shared',
    } as const

    expect(definitionRefKey(classRef)).toBe('contracts.example.dev:class.Shared')
    expect(definitionRefKey(interfaceRef)).toBe('contracts.example.dev:interface.Shared')
    expect(parseDefinitionRefKey(definitionRefKey(classRef))).toEqual(classRef)
    expect(parseDefinitionRefKey(definitionRefKey(interfaceRef))).toEqual(interfaceRef)
  })

  test('guards structural refs without claiming SDK admission', () => {
    expect(isIrSchemaRef({ origin: 'a.dev', kind: 'policy', name: 'may_read' })).toBe(true)
    expect(isIrDefinitionRef({ origin: 'a.dev', kind: 'class', name: 'Thing' })).toBe(true)
    expect(isIrDefinitionRef({ origin: 'a.dev', kind: 'policy', name: 'may_read' })).toBe(false)
    expect(isIrInterfaceRef({ origin: 'a.dev', kind: 'interface', name: 'Named' })).toBe(true)
    expect(isIrInterfaceRef({ origin: 'a.dev', kind: 'class', name: 'Named' })).toBe(false)
    expect(isIrSchemaRef({ origin: 'a.dev', kind: 'unknown', name: 'Thing' })).toBe(false)
    expect(isIrSchemaRef({ origin: 'a.dev', kind: 'class' })).toBe(false)
  })

  test('rejects malformed and non-definition keys', () => {
    expect(parseSchemaRefKey('a.dev:unknown.Thing')).toBeUndefined()
    expect(parseSchemaRefKey('a.dev:class.')).toBeUndefined()
    expect(parseSchemaRefKey(':class.Thing')).toBeUndefined()
    expect(parseSchemaRefKey(null)).toBeUndefined()
    expect(parseDefinitionRefKey('a.dev:type.Payload')).toBeUndefined()
  })
})
