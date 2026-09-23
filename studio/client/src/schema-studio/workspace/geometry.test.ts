import type { Node } from '@xyflow/react'

import { expect, test } from 'bun:test'

import { DOMAIN_PAD } from '../palette'
import {
  layoutWorkspaceFrames,
  placeBeside,
  rectsOverlap,
  WORKSPACE_DOMAIN_GAP,
  workspaceLayoutUpdate,
} from './geometry'

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

test('a domain added after one was moved by hand lands beside it, and moves nothing', () => {
  const alpha = { domainId: 'alpha', nodes: [moduleNode('alpha-module')] }
  const beta = { domainId: 'beta', nodes: [moduleNode('beta-module')] }
  const moved = { alpha: { x: -400, y: 700 } }
  // What the kernel frame was given the first time round, beside where alpha USED to be.
  const kernel = { position: { x: 500, y: 0 }, size: { width: 216, height: 400 } }

  const [first, second] = layoutWorkspaceFrames([alpha, beta], moved, [kernel])

  expect(first.position).toEqual(moved.alpha)
  const alphaRect = { position: first.position, size: first.size }
  expect(rectsOverlap(second, alphaRect, WORKSPACE_DOMAIN_GAP - 1)).toBe(false)
  expect(rectsOverlap(second, kernel, WORKSPACE_DOMAIN_GAP - 1)).toBe(false)
  // Beside the domain the reader placed, not past the far edge of everything.
  expect(second.position).toEqual({
    x: moved.alpha.x + first.size.width + WORKSPACE_DOMAIN_GAP,
    y: moved.alpha.y,
  })
})

test('a new frame never lands on an external frame that already has a place', () => {
  const alpha = { domainId: 'alpha', nodes: [moduleNode('alpha-module')] }
  const beta = { domainId: 'beta', nodes: [moduleNode('beta-module')] }
  const [placedAlpha] = layoutWorkspaceFrames([alpha], {})
  const kernel = {
    position: { x: placedAlpha.size.width + WORKSPACE_DOMAIN_GAP, y: 0 },
    size: { width: 216, height: 300 },
  }

  const [, second] = layoutWorkspaceFrames([alpha, beta], { alpha: placedAlpha.position }, [kernel])

  expect(rectsOverlap(second, kernel, WORKSPACE_DOMAIN_GAP - 1)).toBe(false)
  expect(rectsOverlap(second, placedAlpha, WORKSPACE_DOMAIN_GAP - 1)).toBe(false)
})

test('a hole left between placed frames is filled before the canvas grows', () => {
  const size = { width: 300, height: 200 }
  const obstacles = [
    { position: { x: 0, y: 0 }, size },
    { position: { x: 0, y: 200 + WORKSPACE_DOMAIN_GAP }, size },
    { position: { x: 2 * (300 + WORKSPACE_DOMAIN_GAP), y: 0 }, size },
    { position: { x: 2 * (300 + WORKSPACE_DOMAIN_GAP), y: 200 + WORKSPACE_DOMAIN_GAP }, size },
  ]

  expect(placeBeside(size, obstacles)).toEqual({ x: 300 + WORKSPACE_DOMAIN_GAP, y: 0 })
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

test('a new domain leaves room for the imported frames beside the one already placed', () => {
  const alpha = { domainId: 'alpha', nodes: [moduleNode('alpha-module')], trailing: 400 }
  const beta = { domainId: 'beta', nodes: [moduleNode('beta-module')] }
  const [first, second] = layoutWorkspaceFrames([alpha, beta], { alpha: { x: 0, y: 0 } })

  // Beside alpha, it clears alpha's imported frames; below it, it lines up with alpha.
  const clearsLane = second.position.x >= first.size.width + 400 + WORKSPACE_DOMAIN_GAP
  const below = second.position.y >= first.size.height + WORKSPACE_DOMAIN_GAP
  expect(clearsLane || below).toBe(true)
  expect(first.size).toEqual(second.size)
})
