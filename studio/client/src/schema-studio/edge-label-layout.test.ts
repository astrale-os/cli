import { expect, test } from 'bun:test'

import {
  edgeLabelRect,
  edgeLabelRectsOverlap,
  layoutEdgeLabels,
  placeEdgeLabel,
  type EdgeLabelObstacle,
  type EdgePathSample,
} from './edge-label-layout'

const samples = (...points: Array<[x: number, y: number, distance: number]>): EdgePathSample[] =>
  points.map(([x, y, distance]) => ({ x, y, distance }))
/** A straight path along y = 0, sampled every `step` up to `length`. */
const line = (length: number, step: number) =>
  samples(
    ...Array.from(
      { length: length / step + 1 },
      (_, i) => [i * step, 0, i * step] as [number, number, number],
    ),
  )
const obstacle = (id: string, x: number, y: number, width: number, height: number) =>
  ({ id, x, y, width, height }) as EdgeLabelObstacle
const overlaps = (
  at: { x: number; y: number },
  size: { width: number; height: number },
  box: EdgeLabelObstacle,
  pad?: number,
) => edgeLabelRectsOverlap(edgeLabelRect(at, size, pad), box)

test('a label sits mid-path when clear, slides along it past a card, and leaves it only when it must', () => {
  const size = { width: 30, height: 14 }
  expect(placeEdgeLabel(line(100, 50), size, [], { preferredDistance: 50 })).toEqual({
    x: 50,
    y: 0,
  })

  const node = obstacle('node', 35, -20, 30, 40)
  const small = { width: 20, height: 12 }
  const slid = placeEdgeLabel(line(100, 25), small, [node], { preferredDistance: 50 })!
  expect(slid).toEqual({ x: 0, y: 0 })
  expect(overlaps(slid, small, node, 4)).toBe(false)

  const wide = obstacle('wide-node', -20, -20, 140, 40)
  const off = placeEdgeLabel(line(100, 50), size, [wide], { preferredDistance: 50 })
  expect(off).not.toBeNull()
  expect(overlaps(off!, size, wide, 4)).toBe(false)
})

test('an endpoint chip stays near its own end of the edge', () => {
  const placed = placeEdgeLabel(
    line(100, 25),
    { width: 16, height: 12 },
    [obstacle('source-neighbour', 15, -12, 20, 24)],
    { preferredDistance: 25, maxPathDistance: 24 },
  )
  expect(placed!.x).toBeLessThan(50)
})

test('another edge’s label is slid past on the path, and overlapped rather than a card', () => {
  const small = { width: 20, height: 12 }
  const held = obstacle('other:0', 35, -7, 30, 14)
  const slid = placeEdgeLabel(line(100, 25), small, [], {
    preferredDistance: 50,
    softObstacles: [held],
  })!
  expect(slid.y).toBe(0)
  expect(overlaps(slid, small, held)).toBe(false)

  const size = { width: 30, height: 14 }
  const card = obstacle('card', -40, -60, 180, 44)
  const wide = obstacle('other:0', -60, -12, 220, 24)
  const placed = placeEdgeLabel(line(100, 50), size, [card], {
    preferredDistance: 50,
    softObstacles: [wide],
  })
  expect(overlaps(placed!, size, card, 4)).toBe(false)
})

test('lays parallel edges out so their names do not stack', () => {
  const size = { width: 60, height: 14 }
  const parallel = (y: number) =>
    samples(
      ...Array.from({ length: 21 }, (_, i) => [i * 10, y, i * 10] as [number, number, number]),
    )
  const placements = layoutEdgeLabels(
    ['prepares', 'validates', 'administers'].map((edgeId, i) => ({
      edgeId,
      slot: 0,
      samples: parallel(i * 6),
      size,
      obstacles: [],
      preferredDistance: 100,
    })),
  )

  const rects = [...placements.values()]
  expect(rects.every(Boolean)).toBe(true)
  for (const [index, left] of rects.entries()) {
    for (const right of rects.slice(index + 1)) {
      expect(edgeLabelRectsOverlap(left!, right!)).toBe(false)
    }
  }
})

test('orders the pass by edge, never by input order', () => {
  const size = { width: 40, height: 14 }
  const path = line(200, 50)
  const a = { edgeId: 'a', slot: 0, samples: path, size, obstacles: [], preferredDistance: 100 }
  const b = { edgeId: 'b', slot: 0, samples: path, size, obstacles: [], preferredDistance: 100 }

  expect(layoutEdgeLabels([b, a])).toEqual(layoutEdgeLabels([a, b]))
  expect(layoutEdgeLabels([a, b]).get('a:0')).toMatchObject({ x: 80, y: -7 })
})

test('never lets a chip cover its own edge name', () => {
  const size = { width: 40, height: 14 }
  const path = line(100, 10)
  const placements = layoutEdgeLabels([
    { edgeId: 'e', slot: 0, samples: path, size, obstacles: [], preferredDistance: 50 },
    {
      edgeId: 'e',
      slot: 1,
      samples: path,
      size: { width: 16, height: 12 },
      obstacles: [],
      preferredDistance: 25,
      maxPathDistance: 40,
    },
  ])

  expect(edgeLabelRectsOverlap(placements.get('e:0')!, placements.get('e:1')!)).toBe(false)
})
