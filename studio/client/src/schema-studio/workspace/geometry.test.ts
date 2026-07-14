import type { Node } from '@xyflow/react'

import { expect, test } from 'bun:test'

import { layoutWorkspaceFrames, workspaceLayoutUpdate } from './geometry'

const moduleNode = (id: string): Node => ({
  id,
  type: 'group',
  position: { x: 0, y: 0 },
  data: {},
  style: { width: 240, height: 180 },
})

test('keeps initialized sibling positions stable when another domain is resized', () => {
  const sources = [
    { domainId: 'alpha', nodes: [moduleNode('alpha-module')] },
    { domainId: 'beta', nodes: [moduleNode('beta-module')] },
  ]
  const initial = layoutWorkspaceFrames(sources, {}, {}, {})
  const positions = Object.fromEntries(initial.map((frame) => [frame.domainId, frame.position]))
  const resized = layoutWorkspaceFrames(
    sources,
    positions,
    { alpha: { width: 800, height: 500 } },
    {},
  )

  expect(resized[0].size).toEqual({ width: 800, height: 500 })
  expect(resized[1].position).toEqual(initial[1].position)
})

test('keeps an explicit domain size when its content reaches the frame edge', () => {
  const touching = moduleNode('catalog')
  touching.style = { width: 805, height: 180 }
  const [frame] = layoutWorkspaceFrames(
    [{ domainId: 'alpha', nodes: [touching] }],
    { alpha: { x: 0, y: 0 } },
    { alpha: { width: 857, height: 300 } },
    { alpha: { x: 52, y: 100 } },
  )

  expect(frame.size).toEqual({ width: 857, height: 300 })
})

test('converts a workspace node back to owner-local persisted geometry', () => {
  const node: Node = {
    id: 'workspace:services:grp-service',
    type: 'group',
    position: { x: 107, y: 136 },
    data: {
      workspaceGeometry: {
        domainId: 'services',
        localId: 'grp-service',
        offset: { x: 80, y: 96 },
        active: true,
      },
    },
  }

  expect(workspaceLayoutUpdate(node, { width: 320, height: 240 })).toEqual({
    domainId: 'services',
    updates: {
      'grp-service': { x: 27, y: 40, w: 320, h: 240 },
    },
  })
})
