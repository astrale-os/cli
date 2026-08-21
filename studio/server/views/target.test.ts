import { describe, expect, test } from 'bun:test'

import type { StudioSchemaBundle, ViewInfo } from '../../shared/types'

import { targetDefinition, viewDefinitionBindings } from './target'

describe('view target definitions', () => {
  test('preserves canonical interface View target coordinates', () => {
    const view = { slug: 'users', kind: 'unknown' } satisfies ViewInfo
    const bundle = {
      ir: {
        views: {
          users: {
            name: 'users',
            auth: 'required',
            target: {
              kind: 'definition',
              definitions: [{ origin: 'kernel.astrale.ai', kind: 'interface', name: 'Identity' }],
            },
          },
        },
      },
    } as unknown as StudioSchemaBundle

    expect(viewDefinitionBindings('shell.astrale.ai', view, bundle)).toEqual([
      { className: 'Identity', classOrigin: 'kernel.astrale.ai', kind: 'interface' },
    ])
    expect(targetDefinition('Identity', 'kernel.astrale.ai', 'interface')).toBe(
      '/:kernel.astrale.ai:interface.Identity',
    )
  })

  test('preserves every exact canonical homonym and ignores short-name metadata', () => {
    const view = {
      slug: 'named',
      kind: 'unknown',
      viewFor: 'WrongLegacyTarget',
    } satisfies ViewInfo
    const bundle = {
      ir: {
        views: {
          named: {
            name: 'named',
            auth: 'required',
            target: {
              kind: 'definition',
              definitions: [
                { origin: 'directory.example.dev', kind: 'interface', name: 'Named' },
                { origin: 'people.example.dev', kind: 'interface', name: 'Named' },
                { origin: 'catalog.example.dev', kind: 'class', name: 'Named' },
              ],
            },
          },
        },
      },
    } as unknown as StudioSchemaBundle

    expect(viewDefinitionBindings('shell.astrale.ai', view, bundle)).toEqual([
      { className: 'Named', classOrigin: 'directory.example.dev', kind: 'interface' },
      { className: 'Named', classOrigin: 'people.example.dev', kind: 'interface' },
      { className: 'Named', classOrigin: 'catalog.example.dev', kind: 'class' },
    ])
  })

  test('treats an exact Domain target as authoritative over legacy viewFor', () => {
    const view = { slug: 'home', kind: 'unknown', viewFor: 'User' } satisfies ViewInfo
    const bundle = {
      ir: { views: { home: { name: 'home', auth: 'required', target: { kind: 'domain' } } } },
    } as unknown as StudioSchemaBundle
    expect(viewDefinitionBindings('shell.astrale.ai', view, bundle)).toEqual([])
  })

  test('uses every exact fallback candidate across origin and definition-kind collisions', () => {
    const view = { slug: 'legacy-named', kind: 'unknown', viewFor: 'Named' } satisfies ViewInfo
    const bundle = {
      ir: {
        domain: 'shell.astrale.ai',
        views: {},
        classes: {
          Named: {
            origin: 'shell.astrale.ai',
            ref: { origin: 'shell.astrale.ai', kind: 'class', name: 'Named' },
          },
        },
        interfaces: {
          Named: {
            origin: 'shell.astrale.ai',
            ref: { origin: 'shell.astrale.ai', kind: 'interface', name: 'Named' },
          },
        },
        imports: { Named: { origin: 'legacy.invalid', definition: 'class' } },
        importsByKey: {
          'directory.example.dev:interface.Named': {
            origin: 'directory.example.dev',
            definition: 'interface',
          },
          'catalog.example.dev:class.Named': {
            origin: 'catalog.example.dev',
            definition: 'class',
          },
        },
      },
    } as unknown as StudioSchemaBundle

    expect(viewDefinitionBindings('shell.astrale.ai', view, bundle)).toEqual([
      { className: 'Named', classOrigin: 'shell.astrale.ai', kind: 'class' },
      { className: 'Named', classOrigin: 'shell.astrale.ai', kind: 'interface' },
      { className: 'Named', classOrigin: 'directory.example.dev', kind: 'interface' },
      { className: 'Named', classOrigin: 'catalog.example.dev', kind: 'class' },
    ])
  })

  test('uses the short-name import only for legacy bundles without an exact index', () => {
    const view = { slug: 'legacy-users', kind: 'unknown', viewFor: 'User' } satisfies ViewInfo
    const legacy = {
      ir: {
        domain: 'shell.astrale.ai',
        views: {},
        classes: {},
        interfaces: {},
        imports: { User: { origin: 'accounts.example.dev', definition: 'interface' } },
      },
    } as unknown as StudioSchemaBundle
    const exact = { ir: { ...legacy.ir, importsByKey: {} } } as unknown as StudioSchemaBundle

    expect(viewDefinitionBindings('shell.astrale.ai', view, legacy)).toEqual([
      { className: 'User', classOrigin: 'accounts.example.dev', kind: 'interface' },
    ])
    expect(viewDefinitionBindings('shell.astrale.ai', view, exact)).toEqual([])
  })

  test('addresses exact class instances through a canonical Definition source', () => {
    expect(targetDefinition('Issue', 'issues.astrale.ai')).toBe('/:issues.astrale.ai:class.Issue')
  })
})
