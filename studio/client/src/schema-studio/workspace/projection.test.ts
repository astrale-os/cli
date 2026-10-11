import type { IrClass, StudioSchemaBundle } from '@shared/contracts/schema'

import { expect, test } from 'bun:test'

import { anatomy, bundle, classRef, edgeClass, importClass, nodeClass } from '../__tests__/fixture'
import { projectDomainCanvas } from '../projection'
import { workspaceExternalMemberNodeId, workspaceExternalNodeId } from './external-frames'
import {
  composeWorkspaceCanvas,
  prepareWorkspaceDomain,
  qualifiedNodeId,
  type WorkspaceDomainProjection,
} from './projection'

function domainBundle(id: string, origin: string, classes: Record<string, IrClass>) {
  const value = bundle(classes)
  value.domainId = id
  value.ir!.domain = origin
  return value
}

function prepared(value: StudioSchemaBundle): WorkspaceDomainProjection {
  const structure = projectDomainCanvas(value, new Set(), {}, true)
  return {
    input: {
      summary: {
        id: value.domainId,
        origin: value.ir!.domain,
        path: `/tmp/${value.domainId}`,
        schemaDir: 'schema',
        depsInstalled: true,
        hasGit: false,
        configFile: 'astrale.config.ts',
      },
      bundle: value,
      anatomy: undefined as never,
      layout: { positions: {} },
      visibility: { hidden: {}, showInheritedEdges: true },
    },
    collapsed: new Set(),
    nodes: structure.nodes,
    edges: structure.edges,
  }
}

const remote = classRef('remote.example.dev', 'Remote')
const remoteMember = workspaceExternalMemberNodeId(remote.origin, remote.name, 'class')
const isExternal = (id: string) => id.startsWith('workspace-external:')

/** `local` with a User assigned to `remote.example.dev`'s Remote. */
function assigning() {
  const local = domainBundle('local', 'local.example.dev', {
    User: nodeClass('User'),
    assigned_to: edgeClass('assigned_to', [
      { name: 'user', types: ['User'] },
      { name: 'remote', types: ['Remote'], refs: [remote] },
    ]),
  })
  importClass(local, remote)
  return local
}

test("a domain's views arrive as nodes of the domain, bound to no class", async () => {
  const input = prepared(
    domainBundle('local', 'local.example.dev', { User: nodeClass('User') }),
  ).input
  input.anatomy = anatomy([{ slug: 'board', kind: 'spa', mount: '/ui/board' }])
  // every id already placed, so the layout is a repaint — no ELK worker in a unit test
  input.layout = {
    positions: {
      'grp-root': { x: 0, y: 0 },
      'class.User': { x: 0, y: 0 },
      'view.board': { x: 0, y: 0 },
    },
  }
  const result = await prepareWorkspaceDomain(input, [])
  expect(result.nodes.map((node) => node.id)).toContain('view.board')
  expect(result.edges.filter((edge) => edge.source === 'view.board')).toEqual([])
})

test('a dependency on the canvas links to its Domain frame, never to a grey copy of it', () => {
  const remoteBundle = domainBundle('remote', remote.origin, {
    Remote: nodeClass('Remote', { origin: remote.origin, ref: remote }),
  })
  const result = composeWorkspaceCanvas([prepared(assigning()), prepared(remoteBundle)])
  expect(result.edges).toContainEqual(
    expect.objectContaining({
      source: qualifiedNodeId('local', 'class.User'),
      target: qualifiedNodeId('remote', 'class.Remote'),
    }),
  )
  expect(result.nodes.some((node) => isExternal(node.id))).toBe(false)
})

test('an absent dependency is a grey external frame, unless the reader hid its Domain', () => {
  expect(composeWorkspaceCanvas([prepared(assigning())]).nodes.map((node) => node.id)).toContain(
    remoteMember,
  )
  const hidden = prepared(assigning())
  hidden.input.visibility.hidden = { 'domain.remote.example.dev': true }
  expect(composeWorkspaceCanvas([hidden]).nodes.some((node) => isExternal(node.id))).toBe(false)
})

test('a frame is moved, never selected — with one domain on the canvas or several', () => {
  const first = domainBundle('first', 'first.example.dev', { User: nodeClass('User') })
  const second = domainBundle('second', 'second.example.dev', { Team: nodeClass('Team') })
  const solo = composeWorkspaceCanvas([prepared(first)])
  const pair = composeWorkspaceCanvas([prepared(first), prepared(second)])
  const frames = [...solo.nodes, ...pair.nodes].filter((node) => node.type === 'workspaceDomain')
  expect(frames).toHaveLength(3)
  // no dragHandle: you grab a frame anywhere, exactly like a module box
  expect(frames.every((frame) => frame.draggable && frame.dragHandle === undefined)).toBe(true)
  expect(frames.some((frame) => frame.selectable)).toBe(false)
})

test('inheritance is drawn once: within a domain, across domains, and to a grey parent', () => {
  const solo = domainBundle('solo', 'solo.example.dev', {
    Base: nodeClass('Base', { origin: 'solo.example.dev' }),
    Document: nodeClass('Document', {
      origin: 'solo.example.dev',
      extendsRefs: [classRef('solo.example.dev', 'Base')],
    }),
  })
  const extendsOf = (edges: { data?: { kind?: string } }[]) =>
    edges.filter((edge) => edge.data?.kind === 'extends')
  expect(extendsOf(composeWorkspaceCanvas([prepared(solo)]).edges)).toHaveLength(1)

  const base = classRef('base.example.dev', 'Base')
  const child = domainBundle('child', 'child.example.dev', {
    Child: nodeClass('Child', { origin: 'child.example.dev', extendsRefs: [base] }),
  })
  importClass(child, base)
  const baseBundle = domainBundle('base', base.origin, {
    Base: nodeClass('Base', { origin: base.origin, ref: base }),
  })
  expect(composeWorkspaceCanvas([prepared(child), prepared(baseBundle)]).edges).toContainEqual(
    expect.objectContaining({
      id: `workspace-extends:${qualifiedNodeId('child', 'class.Child')}:${qualifiedNodeId('base', 'class.Base')}`,
    }),
  )

  // a parent in a domain the canvas does not draw is a grey box, not a silence
  const alone = composeWorkspaceCanvas([prepared(child)])
  const target = workspaceExternalMemberNodeId(base.origin, 'Base', 'class')
  expect(alone.nodes.map((node) => node.id)).toContain(target)
  expect(alone.edges).toContainEqual(
    expect.objectContaining({ target, data: expect.objectContaining({ kind: 'extends' }) }),
  )
})

test('Kernel Identity is there to inspect, with no inheritance edge drawn to it', () => {
  const identity = classRef('kernel.astrale.ai', 'Identity')
  const local = domainBundle('local', 'local.example.dev', {
    User: nodeClass('User', { extendsRefs: [identity] }),
  })
  importClass(local, identity, nodeClass('Identity', { origin: identity.origin, ref: identity }))

  const result = composeWorkspaceCanvas([prepared(local)])
  const id = workspaceExternalMemberNodeId(identity.origin, identity.name, 'class')
  expect(result.edges.filter((edge) => edge.data?.kind === 'extends')).toEqual([])
  expect(result.nodes.find((node) => node.id === id)).toMatchObject({
    selectable: true,
    data: { selectionDomainId: 'local', selectionId: 'class.kernel.astrale.ai:class.Identity' },
  })
  const withoutInheritance = prepared(local)
  withoutInheritance.input.visibility.showInheritedEdges = false
  expect(composeWorkspaceCanvas([withoutInheritance]).nodes).toContainEqual(
    expect.objectContaining({ id }),
  )
})

test('a dependency nothing points at is counted in its folded frame, listed once unfolded', () => {
  const settings = classRef('config.example.dev', 'Settings')
  // imported and used somewhere the canvas does not draw — a policy, a View, a property
  const local = domainBundle('local', 'local.example.dev', { User: nodeClass('User') })
  importClass(local, settings)

  const folded = composeWorkspaceCanvas([prepared(local)], {
    workspaceOrigins: { 'config.example.dev': 'config' },
  })
  const frame = folded.nodes.find((node) => node.id === workspaceExternalNodeId(settings.origin))
  expect(frame!.data).toMatchObject({ inertCount: 1, domainId: 'config' })
  expect(folded.nodes.some((node) => node.type === 'extMember')).toBe(false)

  const unfolded = composeWorkspaceCanvas([prepared(local)], {
    expandedExternals: [settings.origin],
  })
  expect(unfolded.nodes.map((node) => node.id)).toContain(
    workspaceExternalMemberNodeId(settings.origin, 'Settings', 'class'),
  )
})
