import { expect, test } from 'bun:test'

import { bundle, classRef, edgeClass, nodeClass } from './__tests__/fixture'
import { type ClassNodeData, projectDomainCanvas } from './projection'

test('renders Node Classes, relation edges, and Class inheritance', () => {
  const fixture = bundle({
    Base: nodeClass('Base'),
    Document: nodeClass('Document', {
      extendsRefs: [classRef('local.example.dev', 'Base')],
    }),
    linked: edgeClass('linked', [
      { name: 'source', types: ['Base'] },
      { name: 'target', types: ['Document'] },
    ]),
  })
  fixture.overlay.sourceSpans = {
    'class.Base': { file: 'schema/content/base.ts', startLine: 1, endLine: 2 },
    'class.Document': { file: 'schema/content/document.ts', startLine: 1, endLine: 2 },
    'edge.linked': { file: 'schema/content/linked.ts', startLine: 1, endLine: 2 },
  }

  const result = projectDomainCanvas(fixture, new Set(), {}, true)
  expect(result.nodes.filter((node) => node.type === 'classNode').map((node) => node.id)).toEqual([
    'class.Base',
    'class.Document',
  ])
  expect(result.edges.map((edge) => edge.id).sort()).toEqual([
    'edge-linked__class.Base__class.Document',
    'extends-Document__Base',
  ])
})

test('routes collapsed module edges through the owning module node', () => {
  const fixture = bundle({
    User: nodeClass('User'),
    Space: nodeClass('Space'),
    owns: edgeClass('owns', [
      { name: 'owner', types: ['User'] },
      { name: 'space', types: ['Space'] },
    ]),
  })
  fixture.overlay.sourceSpans = {
    'class.User': { file: 'schema/identity/user.ts', startLine: 1, endLine: 2 },
    'class.Space': { file: 'schema/space/space.ts', startLine: 1, endLine: 2 },
    'edge.owns': { file: 'schema/space/owns.ts', startLine: 1, endLine: 2 },
  }
  const result = projectDomainCanvas(fixture, new Set(['identity']), {}, false)
  expect(result.edges[0]).toMatchObject({ source: 'grp-identity', target: 'class.Space' })
})

test('honors hidden Classes, and turns inheritance edges off into parent chips', () => {
  const fixture = bundle({
    Base: nodeClass('Base'),
    Document: nodeClass('Document', {
      extendsRefs: [classRef('local.example.dev', 'Base')],
    }),
  })
  const parentsOf = (showInheritedEdges: boolean) =>
    projectDomainCanvas(fixture, new Set(), {}, showInheritedEdges)
      .nodes.filter((node) => node.type === 'classNode')
      .map((node) => (node.data as ClassNodeData).parents)
  expect(projectDomainCanvas(fixture, new Set(), {}, false).edges).toHaveLength(0)
  // edges on: the chips would only repeat what the canvas already draws
  expect(parentsOf(true)).toEqual([[], []])
  expect(parentsOf(false)).toEqual([[], ['Base']])
  expect(
    projectDomainCanvas(fixture, new Set(), { 'class.Base': true }, true)
      .nodes.filter((node) => node.type === 'classNode')
      .map((node) => node.id),
  ).toEqual(['class.Document'])
})

test('keeps Kernel concepts while omitting implementation bases and their inheritance', () => {
  const fixture = bundle({
    Identity: nodeClass('Identity', {
      origin: 'kernel.astrale.ai',
      extendsRefs: [classRef('kernel.astrale.ai', 'Node')],
    }),
    Named: nodeClass('Named', { origin: 'kernel.astrale.ai' }),
    Descriptable: nodeClass('Descriptable', { origin: 'kernel.astrale.ai' }),
    Timestamped: nodeClass('Timestamped', { origin: 'kernel.astrale.ai' }),
    Node: nodeClass('Node', { origin: 'kernel.astrale.ai' }),
    Edge: nodeClass('Edge', { origin: 'kernel.astrale.ai' }),
  })
  fixture.ir!.domain = 'kernel.astrale.ai'

  const result = projectDomainCanvas(fixture, new Set(), {}, true)

  expect(result.nodes.filter((node) => node.type === 'classNode').map((node) => node.id)).toEqual([
    'class.Identity',
  ])
  expect(result.edges.filter((edge) => edge.data?.kind === 'extends')).toEqual([])
})

test('badges Kernel roles at any depth and never shows Kernel parents as chips', () => {
  const fixture = bundle({
    Principal: nodeClass('Principal', {
      extendsRefs: [
        classRef('kernel.astrale.ai', 'Identity'),
        classRef('kernel.astrale.ai', 'Named'),
        classRef('kernel.astrale.ai', 'Timestamped'),
        classRef('shared.example.dev', 'Audited'),
      ],
    }),
    Employee: nodeClass('Employee', {
      extendsRefs: [
        classRef('local.example.dev', 'Principal'),
        classRef('local.example.dev', 'Base'),
      ],
    }),
    RenderableFunction: nodeClass('RenderableFunction', {
      extendsRefs: [
        classRef('kernel.astrale.ai', 'Function'),
        classRef('kernel.astrale.ai', 'View'),
      ],
    }),
    Base: nodeClass('Base'),
  })
  const cards = projectDomainCanvas(fixture, new Set(), {}, false)
    .nodes.filter((node) => node.type === 'classNode')
    .map((node) => node.data as ClassNodeData)
  const card = (name: string) => cards.find((data) => data.name === name)!

  expect(card('Employee').roles).toEqual(['identity'])
  expect(card('Employee').parents).toEqual(['Principal', 'Base'])
  // Every Kernel parent is semantic metadata on the card, never a parent chip.
  expect(card('Principal')).toMatchObject({ roles: ['identity'], parents: ['Audited'] })
  expect(card('RenderableFunction')).toMatchObject({
    roles: ['function', 'view'],
    parents: [],
  })
  expect(card('Base')).toMatchObject({ roles: [], parents: [] })
})

test('draws the Kernel itself without its implementation scaffolding, inheritance included', () => {
  const kernel = (name: string, input: Parameters<typeof nodeClass>[1] = {}) =>
    nodeClass(name, {
      origin: 'kernel.astrale.ai',
      ref: classRef('kernel.astrale.ai', name),
      ...input,
    })
  const fixture = bundle({
    Node: kernel('Node'),
    Identity: kernel('Identity', { extendsRefs: [classRef('kernel.astrale.ai', 'Node')] }),
    Domain: kernel('Domain', { extendsRefs: [classRef('kernel.astrale.ai', 'Identity')] }),
    // `Node` is never drawn on the canvas, so a relationship from it has no end to attach to.
    created_by: edgeClass('created_by', [
      { name: 'node', types: ['Node'] },
      { name: 'creator', types: ['Identity'] },
    ]),
    of_domain: edgeClass('of_domain', [
      { name: 'identity', types: ['Identity'] },
      { name: 'domain', types: ['Domain'] },
    ]),
  })
  fixture.ir!.domain = 'kernel.astrale.ai'

  const result = projectDomainCanvas(fixture, new Set(), {}, true)
  const ids = new Set(result.nodes.map((node) => node.id))
  expect(result.nodes.filter((node) => node.type === 'classNode').map((node) => node.id)).toEqual([
    'class.Domain',
    'class.Identity',
  ])
  expect(result.edges.map((edge) => edge.id).sort()).toEqual([
    'edge-of_domain__class.Identity__class.Domain',
    'extends-Domain__Identity',
  ])
  // every edge lands on a drawn node: the layout engine rejects the graph otherwise
  for (const edge of result.edges) {
    expect(ids.has(edge.source) && ids.has(edge.target)).toBe(true)
  }
})
