import type { IrDefinitionKey, IrInterface, StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { projectDomainCanvas } from './projection'

const iface = (
  origin: string,
  name: string,
  extendsRefs: IrInterface['extendsRefs'] = [],
): IrInterface => ({
  type: 'interface',
  name,
  origin,
  ref: { origin, kind: 'interface', name },
  extends: extendsRefs.map((ref) => ref.name),
  extendsRefs,
  properties: {},
  methods: {},
})

function bundle(): StudioSchemaBundle {
  const roleA = iface('a.example', 'Role', [
    { origin: 'kernel.astrale.ai', kind: 'interface', name: 'Container' },
  ])
  const roleB = iface('b.example', 'Role', [
    { origin: 'kernel.astrale.ai', kind: 'interface', name: 'Function' },
  ])
  return {
    domainId: 'app',
    schemaHash: 'test',
    extractedBy: 'runtime-bun',
    depsInstalled: true,
    ir: {
      format: 'astrale.dsl',
      version: 'v1',
      domain: 'app.example',
      types: {},
      interfaces: { Shared: iface('app.example', 'Shared') },
      classes: {
        Shared: { type: 'node', name: 'Shared', properties: {}, methods: {} },
        ExternalConsumer: {
          type: 'node',
          name: 'ExternalConsumer',
          implements: ['Shared', 'Shared'],
          implementsRefs: [
            { origin: 'contracts.example', kind: 'interface', name: 'Shared' },
            { origin: 'other.example', kind: 'interface', name: 'Shared' },
          ],
          properties: {},
          methods: {},
        },
        LocalConsumer: {
          type: 'node',
          name: 'LocalConsumer',
          implements: ['Shared'],
          implementsRefs: [{ origin: 'app.example', kind: 'interface', name: 'Shared' }],
          properties: {},
          methods: {},
        },
        Worker: {
          type: 'node',
          name: 'Worker',
          implements: ['Role'],
          implementsRefs: [{ origin: 'a.example', kind: 'interface', name: 'Role' }],
          properties: {},
          methods: {},
        },
      },
      imports: {},
      importsByKey: {
        'a.example:interface.Role': {
          origin: 'a.example',
          definition: 'interface',
          ref: { origin: 'a.example', kind: 'interface', name: 'Role' },
          key: 'a.example:interface.Role',
        },
        'b.example:interface.Role': {
          origin: 'b.example',
          definition: 'interface',
          ref: { origin: 'b.example', kind: 'interface', name: 'Role' },
          key: 'b.example:interface.Role',
        },
        'contracts.example:interface.Shared': {
          origin: 'contracts.example',
          definition: 'interface',
          ref: { origin: 'contracts.example', kind: 'interface', name: 'Shared' },
          key: 'contracts.example:interface.Shared',
        },
        'contracts.example:class.Shared': {
          origin: 'contracts.example',
          definition: 'class',
          ref: { origin: 'contracts.example', kind: 'class', name: 'Shared' },
          key: 'contracts.example:class.Shared',
        },
        'other.example:interface.Shared': {
          origin: 'other.example',
          definition: 'interface',
          ref: { origin: 'other.example', kind: 'interface', name: 'Shared' },
          key: 'other.example:interface.Shared',
        },
      },
      importedInterfacesByKey: {
        'a.example:interface.Role': roleA,
        'b.example:interface.Role': roleB,
      } as Record<IrDefinitionKey, IrInterface>,
      functions: {},
    },
    overlay: {
      origin: 'app.example',
      requires: [],
      crossDomainImports: [],
      mixins: [],
      handlerLinks: [],
      sourceSpans: {},
      annotations: [],
    },
    importedInterfaces: { Role: roleB },
    extractedAt: '2026-08-20T00:00:00.000Z',
  }
}

test('keeps exact interface origins and kinds distinct in the focused projection', () => {
  const result = projectDomainCanvas(bundle(), new Set(), {}, true, { Shared: true })

  expect(result.edges.some((edge) => edge.id === 'implements-LocalConsumer__Shared')).toBe(true)
  expect(result.edges.some((edge) => edge.id === 'implements-ExternalConsumer__Shared')).toBe(false)
  expect(
    result.nodes.find((node) => node.id === 'class.ExternalConsumer')?.data.interfaces,
  ).toEqual([
    {
      name: 'Shared',
      identity: 'contracts.example:interface.Shared',
      ref: { origin: 'contracts.example', kind: 'interface', name: 'Shared' },
      selectionId: 'interface.contracts.example:interface.Shared',
    },
    {
      name: 'Shared',
      identity: 'other.example:interface.Shared',
      ref: { origin: 'other.example', kind: 'interface', name: 'Shared' },
      selectionId: 'interface.other.example:interface.Shared',
    },
  ])
  expect(result.nodes.find((node) => node.id === 'class.LocalConsumer')?.data.interfaces).toEqual(
    [],
  )
  expect(result.nodes.find((node) => node.id === 'class.Worker')?.data.coreRole).toBe('container')

  const badged = projectDomainCanvas(bundle(), new Set(), {}, true, {})
  expect(badged.nodes.find((node) => node.id.startsWith('grp-'))?.data.interfaces).toEqual([
    {
      name: 'Shared',
      identity: 'app.example:interface.Shared',
      ref: { origin: 'app.example', kind: 'interface', name: 'Shared' },
      selectionId: 'interface.Shared',
    },
  ])
})
