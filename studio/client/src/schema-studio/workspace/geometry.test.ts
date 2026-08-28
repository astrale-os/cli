import type { Node } from '@xyflow/react'

import { expect, test } from 'bun:test'

import { DOMAIN_PAD } from '../palette'
import { layoutWorkspaceFrames, workspaceLayoutUpdate } from './geometry'

const moduleNode = (id: string): Node => ({
  id,
  type: 'group',
  position: { x: 0, y: 0 },
  data: {},
  style: { width: 240, height: 180 },
})

test('a domain moved on the canvas leaves its neighbours where they were', () => {
  const sources = [
    { domainId: 'alpha', nodes: [moduleNode('alpha-module')] },
    { domainId: 'beta', nodes: [moduleNode('beta-module')] },
  ]
  const initial = layoutWorkspaceFrames(sources, {})
  const positions = Object.fromEntries(initial.map((frame) => [frame.domainId, frame.position]))
  const moved = layoutWorkspaceFrames(sources, { ...positions, alpha: { x: 900, y: 40 } })

  expect(moved[0].position).toEqual({ x: 900, y: 40 })
  expect(moved[1].position).toEqual(initial[1].position)
})

test('a frame wraps its content, padding included — its size is never a preference', () => {
  const wide = moduleNode('catalog')
  wide.style = { width: 805, height: 180 }
  const [frame] = layoutWorkspaceFrames([{ domainId: 'alpha', nodes: [wide] }], {
    alpha: { x: 0, y: 0 },
  })

  expect(frame.size).toEqual({
    width: DOMAIN_PAD * 2 + 805,
    height: DOMAIN_PAD * 2 + 180,
  })
})

test('converts a workspace node back to owner-local persisted geometry', () => {
  const node: Node = {
    id: 'workspace:services:grp-service',
    type: 'group',
    position: { x: 107, y: 136 },
    // the re-fitted size lives in `style` — that is what the record has to carry
    style: { width: 320, height: 240 },
    data: {
      workspaceGeometry: {
        domainId: 'services',
        localId: 'grp-service',
        offset: { x: 80, y: 96 },
      },
    },
  }

  expect(workspaceLayoutUpdate(node)).toEqual({
    domainId: 'services',
    updates: {
      'grp-service': { x: 27, y: 40, w: 320, h: 240 },
    },
  })
})
