import { describe, expect, test } from 'bun:test'

import { parseIntrospectTarget } from '../introspect'

describe('parseIntrospectTarget', () => {
  test('accepts a bare origin', () => {
    const parsed = parseIntrospectTarget('host.astrale.ai')
    expect(parsed.origin).toBe('host.astrale.ai')
    expect(parsed.path.ast.steps).toEqual([])
  })

  test('accepts a Domain-rooted method Path', () => {
    const parsed = parseIntrospectTarget('/:host.astrale.ai:class.Manager:createInstance')
    expect(parsed.origin).toBe('host.astrale.ai')
    expect(parsed.path.ast.steps.at(-1)?.kind).toBe('method')
  })

  test('rejects an @id', () => {
    expect(() => parseIntrospectTarget('@abc')).toThrow('not an @id')
  })
})
