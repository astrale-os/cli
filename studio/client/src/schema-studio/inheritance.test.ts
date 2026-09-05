import { describe, expect, test } from 'bun:test'

import { bundle, classRef, nodeClass } from './__tests__/fixture'
import {
  ancestryOfClass,
  classTier,
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
            abstract: false,
          },
        },
      }),
    }

    expect(resolveClass(fixture, external)?.properties.title).toEqual({ type: 'string' })
    expect(classTier(fixture, external)).toBe('external')
    expect(classTier(fixture, kernel)).toBe('kernel')
    const groups = inheritedGroupsOfClass(fixture, 'Document')
    expect(groups.flatMap((group) => group.methods)).toEqual([])
    expect(groups.map((group) => [group.owner, group.tier])).toEqual([
      ['Named', 'external'],
      ['Identity', 'kernel'],
    ])
  })

  test('retains abstract obligations and excludes concrete parent Methods', () => {
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
            abstract: true,
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
            abstract: false,
          },
        },
      }),
    })
    expect(inheritedGroupsOfClass(fixture, 'Document')[0]).toMatchObject({
      owner: 'Base',
      props: [['title', { type: 'string' }, true]],
      methods: [{ name: 'rename', declaredLocally: true }],
    })
  })

  test('preserves distinct contract origins through concrete intermediates and diamonds', () => {
    const abstractMethod = {
      name: 'run',
      input: {},
      output: { mode: 'value' as const, schema: {} },
      static: false,
      abstract: true,
    }
    const ref = (name: string) => classRef('local.example.dev', name)
    const fixture = bundle({
      Left: nodeClass('Left', { methods: { run: abstractMethod } }),
      Right: nodeClass('Right', { methods: { run: abstractMethod } }),
      Middle: nodeClass('Middle', {
        extendsRefs: [ref('Left'), ref('Right')],
        methods: { run: { ...abstractMethod, abstract: false } },
      }),
      Child: nodeClass('Child', { extendsRefs: [ref('Middle'), ref('Left')] }),
    })
    expect(
      inheritedGroupsOfClass(fixture, 'Child')
        .flatMap((group) => group.methods.map(({ name }) => `${group.owner}.${name}`))
        .sort(),
    ).toEqual(['Left.run', 'Right.run'])
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

  test('reads every Kernel role through an imported base Class', () => {
    const imported = classRef('shared.example.dev', 'InteractiveSurface')
    const identity = classRef('kernel.astrale.ai', 'Identity')
    const fn = classRef('kernel.astrale.ai', 'Function')
    const view = classRef('kernel.astrale.ai', 'View')
    const fixture = bundle({
      Dashboard: nodeClass('Dashboard', { extendsRefs: [imported] }),
    })
    fixture.ir!.importedClassesByKey = {
      'shared.example.dev:class.InteractiveSurface': nodeClass('InteractiveSurface', {
        origin: imported.origin,
        ref: imported,
        extendsRefs: [identity, fn, view],
      }),
    }

    expect(kernelRolesOfClass(fixture, [imported])).toEqual(['identity', 'function', 'view'])
  })

  test('keeps the complete ancestry, including empty and universal Kernel bases', () => {
    const line = classRef('local.example.dev', 'Line')
    const named = classRef('kernel.astrale.ai', 'Named')
    const timestamped = classRef('kernel.astrale.ai', 'Timestamped')
    const node = classRef('kernel.astrale.ai', 'Node')
    const fixture = bundle({
      Line: nodeClass('Line', { extendsRefs: [named, timestamped] }),
      SalaryLine: nodeClass('SalaryLine', { extendsRefs: [line] }),
    })
    fixture.ir!.importedClassesByKey = {
      'kernel.astrale.ai:class.Named': nodeClass('Named', {
        origin: named.origin,
        ref: named,
        extendsRefs: [node],
        properties: { name: { type: 'string' } },
      }),
      'kernel.astrale.ai:class.Timestamped': nodeClass('Timestamped', {
        origin: timestamped.origin,
        ref: timestamped,
        extendsRefs: [node],
        properties: {
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      }),
      'kernel.astrale.ai:class.Node': nodeClass('Node', {
        origin: node.origin,
        ref: node,
      }),
    }

    expect(
      inheritedGroupsOfClass(fixture, 'SalaryLine').map((group) => ({
        owner: group.owner,
        depth: group.depth,
        tier: group.tier,
        resolved: group.resolved,
      })),
    ).toEqual([
      { owner: 'Line', depth: 1, tier: 'local', resolved: true },
      { owner: 'Named', depth: 2, tier: 'kernel', resolved: true },
      { owner: 'Timestamped', depth: 2, tier: 'kernel', resolved: true },
      { owner: 'Node', depth: 3, tier: 'kernel', resolved: true },
    ])
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

  test('lists the whole ancestry by depth, nearest first, each base once', () => {
    const identity = classRef('kernel.astrale.ai', 'Identity')
    const node = classRef('kernel.astrale.ai', 'Node')
    const named = classRef('local.example.dev', 'Named')
    const party = classRef('local.example.dev', 'Party')
    const fixture = bundle({
      Named: nodeClass('Named', { extendsRefs: [node] }),
      Party: nodeClass('Party', { extendsRefs: [named, identity] }),
      // Named is declared here AND reached again through Party: it stays at depth 0
      Member: nodeClass('Member', { extendsRefs: [party, named] }),
    })
    expect(
      ancestryOfClass(fixture, [party, named]).map((level) => level.map((ref) => ref.name)),
    ).toEqual([
      ['Party', 'Named'],
      ['Identity', 'Node'],
    ])
    // The detail panel is exhaustive, including a universal Kernel root on its own.
    expect(ancestryOfClass(fixture, [node])).toEqual([[node]])
    // an unresolvable base still names itself, and ends its branch there
    expect(
      ancestryOfClass(fixture, [classRef('other.example.dev', 'Ghost')]).map((level) =>
        level.map((ref) => ref.name),
      ),
    ).toEqual([['Ghost']])
  })
})
