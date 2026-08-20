import type { IrDefinitionRef, StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { inheritedGroupsOfClass, resolveInterface } from './inheritance'

test('carries canonical required membership into inherited property rows', () => {
  const bundle = {
    ir: {
      imports: {},
      interfaces: {
        Named: {
          type: 'interface',
          name: 'Named',
          properties: { name: { type: 'string' }, alias: { type: 'string' } },
          required: ['name'],
          methods: {},
        },
      },
      classes: {
        Person: {
          type: 'node',
          name: 'Person',
          implements: ['Named'],
          properties: {},
          required: [],
          methods: {},
        },
      },
    },
  } as unknown as StudioSchemaBundle

  expect(inheritedGroupsOfClass(bundle, 'Person')[0]?.props).toEqual([
    ['name', { type: 'string' }, false],
    ['alias', { type: 'string' }, true],
  ])
})

test('keeps homonymous imported interfaces exact across origins and kind collisions', () => {
  const directoryNamed = {
    origin: 'directory.example.dev',
    kind: 'interface',
    name: 'Named',
  } satisfies IrDefinitionRef
  const peopleNamed = {
    origin: 'people.example.dev',
    kind: 'interface',
    name: 'Named',
  } satisfies IrDefinitionRef
  const catalogNamed = {
    origin: 'catalog.example.dev',
    kind: 'class',
    name: 'Named',
  } satisfies IrDefinitionRef
  const bundle = {
    ir: {
      domain: 'app.example.dev',
      imports: {},
      importsByKey: {
        'directory.example.dev:interface.Named': {
          origin: directoryNamed.origin,
          definition: 'interface',
          ref: directoryNamed,
        },
        'people.example.dev:interface.Named': {
          origin: peopleNamed.origin,
          definition: 'interface',
          ref: peopleNamed,
        },
        'catalog.example.dev:class.Named': {
          origin: catalogNamed.origin,
          definition: 'class',
          ref: catalogNamed,
        },
      },
      importedInterfacesByKey: {
        'directory.example.dev:interface.Named': {
          type: 'interface',
          name: 'Named',
          origin: directoryNamed.origin,
          ref: directoryNamed,
          properties: { label: { type: 'string' }, directoryId: { type: 'string' } },
          methods: {},
        },
        'people.example.dev:interface.Named': {
          type: 'interface',
          name: 'Named',
          origin: peopleNamed.origin,
          ref: peopleNamed,
          properties: { label: { type: 'string' }, personId: { type: 'string' } },
          methods: {},
        },
      },
      interfaces: {
        Named: {
          type: 'interface',
          name: 'Named',
          properties: { localTrap: { type: 'boolean' } },
          methods: {},
        },
      },
      classes: {
        Person: {
          type: 'node',
          name: 'Person',
          implements: ['Named', 'Named'],
          implementsRefs: [directoryNamed, peopleNamed],
          properties: { label: { type: 'string' } },
          methods: {},
        },
      },
    },
    importedInterfaces: {
      Named: {
        type: 'interface',
        name: 'Named',
        properties: { legacyTrap: { type: 'null' } },
        methods: {},
      },
    },
  } as unknown as StudioSchemaBundle

  const groups = inheritedGroupsOfClass(bundle, 'Person')
  expect(
    groups.map((group) => ({
      ref: group.ref,
      origin: group.origin,
      props: group.props.map(([name]) => name),
    })),
  ).toEqual([
    {
      ref: directoryNamed,
      origin: directoryNamed.origin,
      props: ['directoryId'],
    },
    { ref: peopleNamed, origin: peopleNamed.origin, props: ['personId'] },
  ])
  expect(resolveInterface(bundle, directoryNamed)?.properties).toHaveProperty('directoryId')
  expect(resolveInterface(bundle, catalogNamed)).toBeUndefined()
})
