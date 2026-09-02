import type { Node } from '@xyflow/react'

import { expect, test } from 'bun:test'

import { clusterByClass } from './cluster'

const card = (id: string, className: string): Node => ({
  id,
  type: 'coreNode',
  position: { x: 0, y: 0 },
  data: { className },
  style: { width: 184, height: 50 },
})

const box = (nodes: Node[]) => ({
  left: Math.min(...nodes.map((n) => n.position.x)),
  right: Math.max(...nodes.map((n) => n.position.x + 184)),
  top: Math.min(...nodes.map((n) => n.position.y)),
  bottom: Math.max(...nodes.map((n) => n.position.y + 50)),
})

test('gathers every card of a class into one block, blocks apart from each other', () => {
  const laid = clusterByClass([
    card('a1', 'Actor'),
    card('d1', 'Document'),
    card('a2', 'Actor'),
    card('g1', 'Group'),
    card('d2', 'Document'),
    card('a3', 'Actor'),
    card('d3', 'Document'),
    card('d4', 'Document'),
  ])
  const of = (className: string) =>
    laid.filter((n) => (n.data as { className: string }).className === className)
  const documents = box(of('Document'))
  const actors = box(of('Actor'))
  const groups = box(of('Group'))
  // the biggest family comes first, at the origin
  expect(documents.left).toBe(0)
  expect(documents.top).toBe(0)
  // four documents make a 2×2 grid
  expect(of('Document').map((n) => n.position)).toEqual([
    { x: 0, y: 0 },
    { x: 184 + 28, y: 0 },
    { x: 0, y: 50 + 18 },
    { x: 184 + 28, y: 50 + 18 },
  ])
  // blocks never overlap: each next block starts past the previous one
  expect(actors.left).toBeGreaterThanOrEqual(documents.right + 96)
  expect(groups.left).toBeGreaterThanOrEqual(actors.right + 96)
  // no card moved without a position
  expect(laid).toHaveLength(8)
})

test('wraps blocks onto a new row past the width budget', () => {
  const nodes = Array.from({ length: 12 }, (_, i) => card(`n${i}`, `Class${i}`))
  const laid = clusterByClass(nodes, { gapX: 28, gapY: 18, blockGap: 96, maxRowWidth: 600 })
  const rows = new Set(laid.map((n) => n.position.y))
  expect(rows.size).toBeGreaterThan(1)
  // a single-card block is 184 wide: three fit in 600 (184·3 + 96·2 = 744 > 600 → two per row)
  expect(laid.filter((n) => n.position.y === 0)).toHaveLength(2)
})
