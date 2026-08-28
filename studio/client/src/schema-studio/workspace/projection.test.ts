import type { DomainAnatomy, IrClass, StudioSchemaBundle } from '@shared/types'

import { describe, expect, test } from 'bun:test'

import { bundle, classRef, edgeClass, nodeClass } from '../__tests__/fixture'
import { projectDomainCanvas } from '../projection'
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

    const result = composeWorkspaceCanvas([prepared(local), prepared(remoteBundle)], {
      activeDomainId: 'local',
    })
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
    const result = composeWorkspaceCanvas([prepared(local)], { activeDomainId: 'local' })
    expect(result.nodes.map((node) => node.id)).toContain(
      'workspace-external-member:remote.example.dev:class:Remote',
    )
  })

  test('a lone domain gets a frame that is scenery, not furniture to arrange', () => {
    const solo = domainBundle('solo', 'solo.example.dev', { User: nodeClass('User') })
    const result = composeWorkspaceCanvas([prepared(solo)], { activeDomainId: 'solo' })
    const frame = result.nodes.find((node) => node.type === 'workspaceDomain')!

    expect(frame.data).toMatchObject({ solo: true })
    expect(frame.draggable).toBe(false)
    expect(frame.selectable).toBe(false)
  })

  test('a second domain turns both frames into things you can move', () => {
    const first = domainBundle('first', 'first.example.dev', { User: nodeClass('User') })
    const second = domainBundle('second', 'second.example.dev', { Team: nodeClass('Team') })
    const result = composeWorkspaceCanvas([prepared(first), prepared(second)], {
      activeDomainId: 'first',
    })
    const frames = result.nodes.filter((node) => node.type === 'workspaceDomain')

    expect(frames).toHaveLength(2)
    expect(frames.every((frame) => frame.draggable && frame.selectable)).toBe(true)
    expect(frames.every((frame) => (frame.data as { solo: boolean }).solo === false)).toBe(true)
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

    const result = composeWorkspaceCanvas([projection], { activeDomainId: 'local' })

    expect(result.nodes.some((node) => node.id.startsWith('workspace-external:'))).toBe(false)
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
    const result = composeWorkspaceCanvas([prepared(childBundle), prepared(baseBundle)], {
      activeDomainId: 'child',
    })
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        id: `workspace-extends:${qualifiedNodeId('child', 'class.Child')}:${qualifiedNodeId('base', 'class.Base')}`,
      }),
    )
  })
})
