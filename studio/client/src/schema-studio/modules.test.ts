import { describe, expect, test } from 'bun:test'

import { bundle, edgeClass, nodeClass } from './__tests__/fixture'
import { buildModuleTree, folderModules, moduleMembers, moduleOfClass } from './modules'

describe('schema modules', () => {
  const fixture = bundle({
    User: nodeClass('User'),
    Space: nodeClass('Space'),
    owns: edgeClass('owns', [
      { name: 'owner', types: ['User'] },
      { name: 'space', types: ['Space'] },
    ]),
  })
  fixture.overlay.sourceSpans = {
    'class.User': { file: 'schema/identity/user.ts', startLine: 1, endLine: 4 },
    'class.Space': { file: 'schema/space/space.ts', startLine: 1, endLine: 4 },
    'edge.owns': { file: 'schema/space/owns.ts', startLine: 1, endLine: 4 },
  }

  test('groups Node and Edge Classes by authored schema folder', () => {
    expect(
      folderModules(fixture).map(({ path, classes, edges }) => ({ path, classes, edges })),
    ).toEqual([
      { path: 'identity', classes: ['User'], edges: [] },
      { path: 'space', classes: ['Space'], edges: ['owns'] },
    ])
    expect(moduleOfClass(fixture, 'Space')).toBe('space')
  })

  test('builds a class-only tree with stable selection identity', () => {
    const tree = buildModuleTree(fixture)
    expect(tree.children.map((child) => child.path)).toEqual(['identity', 'space'])
    expect(
      tree.children[1]?.members.map((member) => [member.kind, member.selectId, member.ref]),
    ).toEqual([
      ['class', 'class.Space', 'class.Space'],
      ['edge', 'class.owns', 'edge.owns'],
    ])
  })

  test('summarizes nested module contents without inventing schema members', () => {
    expect(moduleMembers(fixture, 'space')).toMatchObject({
      classes: [{ name: 'Space' }],
      edges: [{ name: 'owns' }],
      files: ['space/owns', 'space/space'],
    })
  })
})
