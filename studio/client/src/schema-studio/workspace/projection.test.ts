import type { DomainAnatomy, IrClass, StudioSchemaBundle } from '@shared/types'

import { describe, expect, test } from 'bun:test'

import { bundle, classRef, edgeClass, nodeClass } from '../__tests__/fixture'
import { projectDomainCanvas } from '../projection'
import { workspaceExternalMemberNodeId, workspaceExternalNodeId } from './external-frames'
import {
  composeWorkspaceCanvas,
  prepareWorkspaceDomain,
  qualifiedNodeId,
  type WorkspaceDomainProjection,
} from './projection'

function domainBundle(
  id: string,
  origin: string,
  classes: Record<string, IrClass>,
): StudioSchemaBundle {
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

function anatomy(views: DomainAnatomy['views'], origin: string): DomainAnatomy {
  return {
    overview: { origin, adapter: 'astrale', requires: [], astraleDeps: {}, schemaDir: 'schema' },
    views,
    client: { routes: {}, shell: [], features: [], present: true },
    env: [],
    detectedIntegrations: [],
  }
}

describe('workspace projection', () => {
  test("a domain's views arrive as nodes of the domain, bound to what they render", async () => {
    const value = domainBundle('local', 'local.example.dev', { User: nodeClass('User') })
    const input = prepared(value).input
    input.anatomy = anatomy(
      [{ slug: 'board', kind: 'spa', mount: '/ui/board', viewFor: 'User' }],
      'local.example.dev',
    )
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
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'view.board', target: 'class.User' }),
    )
  })

  test('resolves an exact dependency Class to the selected Domain frame', () => {
    const remote = classRef('remote.example.dev', 'Remote')
    const local = domainBundle('local', 'local.example.dev', {
      User: nodeClass('User'),
      assigned_to: edgeClass('assigned_to', [
        { name: 'user', types: ['User'], refs: [classRef('local.example.dev', 'User')] },
        { name: 'remote', types: ['Remote'], refs: [remote] },
      ]),
    })
    local.ir!.importsByKey = {
      'remote.example.dev:class.Remote': {
        origin: remote.origin,
        ref: remote,
        key: 'remote.example.dev:class.Remote',
      },
    }
    const remoteBundle = domainBundle('remote', remote.origin, {
      Remote: nodeClass('Remote', { origin: remote.origin, ref: remote }),
    })

    const result = composeWorkspaceCanvas([prepared(local), prepared(remoteBundle)])
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: qualifiedNodeId('local', 'class.User'),
        target: qualifiedNodeId('remote', 'class.Remote'),
      }),
    )
    expect(result.nodes.some((node) => node.id.startsWith('workspace-external:'))).toBe(false)
  })

  test('keeps absent dependency Classes in an exact external frame', () => {
    const remote = classRef('remote.example.dev', 'Remote')
    const local = domainBundle('local', 'local.example.dev', {
      User: nodeClass('User'),
      assigned_to: edgeClass('assigned_to', [
        { name: 'user', types: ['User'] },
        { name: 'remote', types: ['Remote'], refs: [remote] },
      ]),
    })
    local.ir!.importsByKey = {
      'remote.example.dev:class.Remote': {
        origin: remote.origin,
        ref: remote,
        key: 'remote.example.dev:class.Remote',
      },
    }
    const result = composeWorkspaceCanvas([prepared(local)])
    expect(result.nodes.map((node) => node.id)).toContain(
      'workspace-external-member:remote.example.dev:class:Remote',
    )
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

  test('an imported Domain the reader hid contributes no external frame', () => {
    const remote = classRef('remote.example.dev', 'Remote')
    const local = domainBundle('local', 'local.example.dev', {
      User: nodeClass('User'),
      assigned_to: edgeClass('assigned_to', [
        { name: 'user', types: ['User'] },
        { name: 'remote', types: ['Remote'], refs: [remote] },
      ]),
    })
    local.ir!.importsByKey = {
      'remote.example.dev:class.Remote': {
        origin: remote.origin,
        ref: remote,
        key: 'remote.example.dev:class.Remote',
      },
    }
    const projection = prepared(local)
    projection.input.visibility = {
      hidden: { 'domain.remote.example.dev': true },
      showInheritedEdges: true,
    }

    const result = composeWorkspaceCanvas([projection])

    expect(result.nodes.some((node) => node.id.startsWith('workspace-external:'))).toBe(false)
  })

  test('draws a same-domain `extends` once, not once per pass', () => {
    const value = domainBundle('solo', 'solo.example.dev', {
      Base: nodeClass('Base', { origin: 'solo.example.dev' }),
      Document: nodeClass('Document', {
        origin: 'solo.example.dev',
        extendsRefs: [classRef('solo.example.dev', 'Base')],
      }),
    })

    const result = composeWorkspaceCanvas([prepared(value)])

    // the domain's own projection owns it; the workspace pass only adds what crosses domains
    expect(result.edges.filter((edge) => edge.data?.kind === 'extends')).toHaveLength(1)
  })

  test('draws cross-domain Class inheritance only when the owner enables it', () => {
    const base = classRef('base.example.dev', 'Base')
    const childBundle = domainBundle('child', 'child.example.dev', {
      Child: nodeClass('Child', { origin: 'child.example.dev', extendsRefs: [base] }),
    })
    childBundle.ir!.importsByKey = {
      'base.example.dev:class.Base': {
        origin: base.origin,
        ref: base,
        key: 'base.example.dev:class.Base',
      },
    }
    const baseBundle = domainBundle('base', base.origin, {
      Base: nodeClass('Base', { origin: base.origin, ref: base }),
    })
    const result = composeWorkspaceCanvas([prepared(childBundle), prepared(baseBundle)])
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        id: `workspace-extends:${qualifiedNodeId('child', 'class.Child')}:${qualifiedNodeId('base', 'class.Base')}`,
      }),
    )
  })

  test('a dependency nothing points at is on the canvas all the same, folded into its frame', () => {
    const settings = classRef('config.example.dev', 'Settings')
    const local = domainBundle('local', 'local.example.dev', { User: nodeClass('User') })
    // Imported and used somewhere the canvas does not draw — a policy, a View, a property.
    local.ir!.importsByKey = {
      'config.example.dev:class.Settings': {
        origin: settings.origin,
        ref: settings,
        key: 'config.example.dev:class.Settings',
      },
    }

    const result = composeWorkspaceCanvas([prepared(local)])
    const frame = result.nodes.find(
      (node) => node.id === workspaceExternalNodeId('config.example.dev'),
    )

    expect(frame).toBeDefined()
    expect(frame!.data.inertCount).toBe(1)
    // folded by default: the frame counts them rather than carding a wall of grey boxes
    expect(result.nodes.some((node) => node.type === 'extMember')).toBe(false)
  })

  test('unfolding an external frame lists what it was only counting', () => {
    const settings = classRef('config.example.dev', 'Settings')
    const local = domainBundle('local', 'local.example.dev', { User: nodeClass('User') })
    local.ir!.importsByKey = {
      'config.example.dev:class.Settings': {
        origin: settings.origin,
        ref: settings,
        key: 'config.example.dev:class.Settings',
      },
    }

    const result = composeWorkspaceCanvas([prepared(local)], {
      expandedExternals: ['config.example.dev'],
    })

    expect(result.nodes.map((node) => node.id)).toContain(
      workspaceExternalMemberNodeId('config.example.dev', 'Settings', 'class'),
    )
  })

  test('a parent in a domain the canvas does not draw is a grey box, not a silence', () => {
    const base = classRef('base.example.dev', 'Base')
    const child = domainBundle('child', 'child.example.dev', {
      Child: nodeClass('Child', { origin: 'child.example.dev', extendsRefs: [base] }),
    })
    child.ir!.importsByKey = {
      'base.example.dev:class.Base': {
        origin: base.origin,
        ref: base,
        key: 'base.example.dev:class.Base',
      },
    }

    const result = composeWorkspaceCanvas([prepared(child)])
    const target = workspaceExternalMemberNodeId('base.example.dev', 'Base', 'class')

    // it used to be dropped without a trace — no box, no edge, no diagnostic
    expect(result.nodes.map((node) => node.id)).toContain(target)
    expect(result.edges).toContainEqual(
      expect.objectContaining({ target, data: expect.objectContaining({ kind: 'extends' }) }),
    )
  })

  test('a Domain the canvas draws never also appears as a grey dependency of itself', () => {
    const remote = classRef('remote.example.dev', 'Remote')
    const local = domainBundle('local', 'local.example.dev', { User: nodeClass('User') })
    local.ir!.importsByKey = {
      'remote.example.dev:class.Remote': {
        origin: remote.origin,
        ref: remote,
        key: 'remote.example.dev:class.Remote',
      },
    }
    const remoteBundle = domainBundle('remote', remote.origin, {
      Remote: nodeClass('Remote', { origin: remote.origin, ref: remote }),
    })

    const result = composeWorkspaceCanvas([prepared(local), prepared(remoteBundle)])

    expect(result.nodes.some((node) => node.id.startsWith('workspace-external:'))).toBe(false)
  })

  test('a grey frame knows when it stands for a domain this workspace could simply draw', () => {
    const settings = classRef('config.example.dev', 'Settings')
    const local = domainBundle('local', 'local.example.dev', { User: nodeClass('User') })
    local.ir!.importsByKey = {
      'config.example.dev:class.Settings': {
        origin: settings.origin,
        ref: settings,
        key: 'config.example.dev:class.Settings',
      },
    }

    const result = composeWorkspaceCanvas([prepared(local)], {
      workspaceOrigins: { 'config.example.dev': 'config' },
    })
    const frame = result.nodes.find(
      (node) => node.id === workspaceExternalNodeId('config.example.dev'),
    )!

    expect(frame.data.domainId).toBe('config')
  })
})
