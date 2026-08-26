import { describe, expect, test } from 'bun:test'

import type { StudioSchemaBundle, ViewInfo } from '../../shared/types'

import { targetDefinition, viewDefinitionBindings } from './target'

describe('View target definitions', () => {
  test('preserves every exact canonical Class target and ignores short-name metadata', () => {
    const view = {
      slug: 'named',
      kind: 'unknown',
      viewFor: 'WrongFallback',
    } satisfies ViewInfo
    const bundle = {
      ir: {
        views: {
          named: {
            name: 'named',
            target: {
              kind: 'definition',
              definitions: [
                { origin: 'directory.example.dev', kind: 'class', name: 'Named' },
                { origin: 'people.example.dev', kind: 'class', name: 'Named' },
              ],
            },
          },
        },
      },
    } as unknown as StudioSchemaBundle
    expect(viewDefinitionBindings('shell.astrale.ai', view, bundle)).toEqual([
      { className: 'Named', classOrigin: 'directory.example.dev', kind: 'class' },
      { className: 'Named', classOrigin: 'people.example.dev', kind: 'class' },
    ])
  })

  test('treats a canonical Domain target as authoritative', () => {
    const view = { slug: 'home', kind: 'unknown', viewFor: 'User' } satisfies ViewInfo
    const bundle = {
      ir: { views: { home: { name: 'home', target: { kind: 'domain' } } } },
    } as unknown as StudioSchemaBundle
    expect(viewDefinitionBindings('shell.astrale.ai', view, bundle)).toEqual([])
  })

  test('resolves fallback targets through local and exact imported Classes', () => {
    const view = { slug: 'named', kind: 'unknown', viewFor: 'Named' } satisfies ViewInfo
    const bundle = {
      ir: {
        domain: 'shell.astrale.ai',
        views: {},
        classes: {
          Named: {
            type: 'node',
            name: 'Named',
            origin: 'shell.astrale.ai',
            properties: {},
            methods: {},
          },
        },
        importsByKey: {
          'catalog.example.dev:class.Named': {
            origin: 'catalog.example.dev',
            ref: { origin: 'catalog.example.dev', kind: 'class', name: 'Named' },
            key: 'catalog.example.dev:class.Named',
          },
        },
      },
    } as unknown as StudioSchemaBundle
    expect(viewDefinitionBindings('shell.astrale.ai', view, bundle)).toEqual([
      { className: 'Named', classOrigin: 'shell.astrale.ai', kind: 'class' },
      { className: 'Named', classOrigin: 'catalog.example.dev', kind: 'class' },
    ])
  })

  test('addresses exact Class instances through a canonical Definition source', () => {
    expect(targetDefinition('Issue', 'issues.astrale.ai')).toBe('/:issues.astrale.ai:class.Issue')
  })
})
