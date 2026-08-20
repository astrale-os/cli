import { expect, test } from 'bun:test'

import type { SchemaIR } from '../../shared/types'

import { buildOverlay } from './overlay'

test('preserves homonymous and cross-kind imports from the exact index', () => {
  const ir = {
    version: 'v1',
    domain: 'app.example',
    types: {},
    interfaces: {},
    classes: {},
    functions: {},
    imports: {},
    importsByKey: {
      'a.example:interface.Shared': {
        origin: 'a.example',
        definition: 'interface',
        ref: { origin: 'a.example', kind: 'interface', name: 'Shared' },
        key: 'a.example:interface.Shared',
      },
      'b.example:interface.Shared': {
        origin: 'b.example',
        definition: 'interface',
        ref: { origin: 'b.example', kind: 'interface', name: 'Shared' },
        key: 'b.example:interface.Shared',
      },
      'a.example:class.Shared': {
        origin: 'a.example',
        definition: 'class',
        ref: { origin: 'a.example', kind: 'class', name: 'Shared' },
        key: 'a.example:class.Shared',
      },
      'kernel.astrale.ai:interface.Identity': {
        origin: 'kernel.astrale.ai',
        definition: 'interface',
        ref: { origin: 'kernel.astrale.ai', kind: 'interface', name: 'Identity' },
        key: 'kernel.astrale.ai:interface.Identity',
      },
    },
  } satisfies SchemaIR

  const overlay = buildOverlay({ ir, domainRoot: '', schemaDir: '' })

  expect(overlay.crossDomainImports).toEqual([
    { name: 'Shared', origin: 'a.example', definition: 'interface' },
    { name: 'Shared', origin: 'b.example', definition: 'interface' },
    { name: 'Shared', origin: 'a.example', definition: 'class' },
  ])
  expect(overlay.mixins).toEqual([
    { name: 'Identity', origin: 'kernel.astrale.ai', definition: 'interface' },
  ])
})

test('retains the legacy short-name import fallback', () => {
  const ir = {
    version: 'legacy',
    domain: 'app.example',
    types: {},
    interfaces: {},
    classes: {},
    functions: {},
    imports: {
      Identity: { origin: 'kernel.astrale.ai', definition: 'interface' },
    },
  } satisfies SchemaIR

  expect(buildOverlay({ ir, domainRoot: '', schemaDir: '' }).mixins).toEqual([
    { name: 'Identity', origin: 'kernel.astrale.ai', definition: 'interface' },
  ])
})
