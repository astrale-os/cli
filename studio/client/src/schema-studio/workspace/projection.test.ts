import type { IrClass, StudioSchemaBundle } from '@shared/types'

import { describe, expect, test } from 'bun:test'

import { bundle, classRef, edgeClass, nodeClass } from '../__tests__/fixture'
import { projectDomainCanvas } from '../projection'
import {
  composeWorkspaceCanvas,
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
  value.overlay.origin = origin
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

describe('workspace projection', () => {
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
