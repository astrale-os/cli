import { describe, expect, test } from 'bun:test'

import { bundle, classRef, nodeClass } from './__tests__/fixture'
import {
  classTier,
  inheritedCount,
  inheritedGroupsOfClass,
  kernelRolesOfClass,
  resolveClass,
} from './inheritance'

describe('Class inheritance', () => {
  test('resolves exact local, dependency, and Kernel base Classes', () => {
    const external = classRef('shared.example.dev', 'Named')
    const kernel = classRef('kernel.astrale.ai', 'Identity')
    const fixture = bundle({
      Document: nodeClass('Document', { extendsRefs: [external, kernel] }),
    })
    fixture.ir!.importsByKey = {
      'shared.example.dev:class.Named': {
        origin: external.origin,
        ref: external,
        key: 'shared.example.dev:class.Named',
      },
      'kernel.astrale.ai:class.Identity': {
        origin: kernel.origin,
        ref: kernel,
        key: 'kernel.astrale.ai:class.Identity',
      },
    }
    fixture.ir!.importedClassesByKey = {
      'shared.example.dev:class.Named': nodeClass('Named', {
        origin: external.origin,
        ref: external,
        properties: { title: { type: 'string' } },
        required: ['title'],
      }),
      'kernel.astrale.ai:class.Identity': nodeClass('Identity', {
        origin: kernel.origin,
        ref: kernel,
        methods: {
          whois: {
            name: 'whois',
            input: { type: 'object', properties: {} },
            output: { mode: 'value', schema: { type: 'string' } },
            static: true,
            inheritance: 'default',
          },
        },
      }),
    }

    expect(resolveClass(fixture, external)?.properties.title).toEqual({ type: 'string' })
    expect(classTier(fixture, external)).toBe('external')
    expect(classTier(fixture, kernel)).toBe('kernel')
    const groups = inheritedGroupsOfClass(fixture, 'Document')
    expect(groups.map((group) => [group.owner, group.tier])).toEqual([
      ['Named', 'external'],
      ['Identity', 'kernel'],
    ])
    expect(inheritedCount(groups)).toBe(2)
  })

  test('deduplicates transitive members and marks local overrides', () => {
    const base = classRef('local.example.dev', 'Base')
    const fixture = bundle({
      Base: nodeClass('Base', {
        properties: { title: { type: 'string' } },
        methods: {
          rename: {
            name: 'rename',
            input: { type: 'object', properties: {} },
            output: { mode: 'value', schema: {} },
            static: false,
            inheritance: 'default',
          },
        },
      }),
      Document: nodeClass('Document', {
        extendsRefs: [base],
        methods: {
          rename: {
            name: 'rename',
            input: { type: 'object', properties: {} },
            output: { mode: 'value', schema: {} },
            static: false,
            inheritance: 'default',
          },
        },
      }),
    })
    expect(inheritedGroupsOfClass(fixture, 'Document')[0]).toMatchObject({
      owner: 'Base',
      props: [['title', { type: 'string' }, true]],
      methods: [{ name: 'rename', overridden: true }],
    })
  })

  test('reads Kernel roles off the whole chain, not just the declared parents', () => {
    const identity = classRef('kernel.astrale.ai', 'Identity')
    const fn = classRef('kernel.astrale.ai', 'Function')
    const principal = classRef('local.example.dev', 'Principal')
    const employee = classRef('local.example.dev', 'Employee')
    const fixture = bundle({
      Principal: nodeClass('Principal', { extendsRefs: [identity] }),
      Employee: nodeClass('Employee', { extendsRefs: [principal] }),
      Manager: nodeClass('Manager', { extendsRefs: [employee] }),
      Plain: nodeClass('Plain'),
      Callable: nodeClass('Callable', { extendsRefs: [fn] }),
    })

    // three hops from the kernel base and still an Identity — that is what inheritance means
    expect(kernelRolesOfClass(fixture, [employee])).toEqual(['identity'])
    expect(kernelRolesOfClass(fixture, [classRef('local.example.dev', 'Plain')])).toEqual([])
    expect(kernelRolesOfClass(fixture, [fn, identity])).toEqual(['identity', 'function'])
  })

  test('survives a cycle in the declared chain', () => {
    const left = classRef('local.example.dev', 'Left')
    const right = classRef('local.example.dev', 'Right')
    const fixture = bundle({
      Left: nodeClass('Left', { extendsRefs: [right] }),
      Right: nodeClass('Right', { extendsRefs: [left, classRef('kernel.astrale.ai', 'Identity')] }),
    })
    expect(kernelRolesOfClass(fixture, [left])).toEqual(['identity'])
  })
})
