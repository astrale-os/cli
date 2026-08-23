import { describe, expect, test } from 'bun:test'

import { bundle, classRef, edgeClass, nodeClass } from './__tests__/fixture'
import { projectDomainCanvas } from './projection'

describe('Domain canvas projection', () => {
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
    expect(result.nodes.filter((node) => node.type === 'classNode').map((node) => node.id)).toEqual(
      ['class.Base', 'class.Document'],
    )
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

  test('honors hidden Classes and the inheritance toggle independently', () => {
    const fixture = bundle({
      Base: nodeClass('Base'),
      Document: nodeClass('Document', {
        extendsRefs: [classRef('local.example.dev', 'Base')],
      }),
    })
    expect(projectDomainCanvas(fixture, new Set(), {}, false).edges).toHaveLength(0)
    expect(
      projectDomainCanvas(fixture, new Set(), { 'class.Base': true }, true)
        .nodes.filter((node) => node.type === 'classNode')
        .map((node) => node.id),
    ).toEqual(['class.Document'])
  })
})
