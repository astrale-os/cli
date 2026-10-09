import { describe, expect, test } from 'bun:test'

import {
  createEdgeLabelObstacleIndex,
  edgeLabelRect,
  edgeLabelRectsOverlap,
  layoutEdgeLabels,
  placeEdgeLabel,
  type EdgeLabelObstacle,
  type EdgePathSample,
} from './edge-label-layout'

const samples = (...points: Array<[x: number, y: number, distance: number]>): EdgePathSample[] =>
  points.map(([x, y, distance]) => ({ x, y, distance }))

const obstacle = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): EdgeLabelObstacle => ({ id, x, y, width, height })

describe('edge label placement', () => {
  test('keeps a clear relationship label at the middle of its rendered path', () => {
    expect(
      placeEdgeLabel(
        samples([0, 0, 0], [50, 0, 50], [100, 0, 100]),
        { width: 30, height: 14 },
        [],
        {
          preferredDistance: 50,
        },
      ),
    ).toEqual({ x: 50, y: 0 })
  })

  test('moves along the path instead of covering a node', () => {
    const nodes = [obstacle('node', 35, -20, 30, 40)]
    const placed = placeEdgeLabel(
      samples([0, 0, 0], [25, 0, 25], [50, 0, 50], [75, 0, 75], [100, 0, 100]),
      { width: 20, height: 12 },
      nodes,
      { preferredDistance: 50 },
    )

    expect(placed).toEqual({ x: 0, y: 0 })
    expect(
      edgeLabelRectsOverlap(edgeLabelRect(placed!, { width: 20, height: 12 }, 4), nodes[0]!),
    ).toBe(false)
  })

  test('moves off the path when a card occupies every path candidate', () => {
    const nodes = [obstacle('wide-node', -20, -20, 140, 40)]
    const placed = placeEdgeLabel(
      samples([0, 0, 0], [50, 0, 50], [100, 0, 100]),
      { width: 30, height: 14 },
      nodes,
      { preferredDistance: 50 },
    )

    expect(placed).not.toBeNull()
    expect(
      edgeLabelRectsOverlap(edgeLabelRect(placed!, { width: 30, height: 14 }, 4), nodes[0]!),
    ).toBe(false)
  })

  test('uses the spatial obstacle index without changing placement', () => {
    const nodes = [obstacle('node', 35, -20, 30, 40)]
    const path = samples([0, 0, 0], [25, 0, 25], [50, 0, 50], [75, 0, 75], [100, 0, 100])
    const options = { preferredDistance: 50 }

    expect(
      placeEdgeLabel(path, { width: 20, height: 12 }, createEdgeLabelObstacleIndex(nodes), options),
    ).toEqual(placeEdgeLabel(path, { width: 20, height: 12 }, nodes, options))
  })

  test('keeps an endpoint chip near its own end of the edge', () => {
    const placed = placeEdgeLabel(
      samples([0, 0, 0], [25, 0, 25], [50, 0, 50], [75, 0, 75], [100, 0, 100]),
      { width: 16, height: 12 },
      [obstacle('source-neighbour', 15, -12, 20, 24)],
      { preferredDistance: 25, maxPathDistance: 24 },
    )

    expect(placed).not.toBeNull()
    expect(placed!.x).toBeLessThan(50)
  })

  test('slides along its path to clear a label another edge already holds', () => {
    const path = samples([0, 0, 0], [25, 0, 25], [50, 0, 50], [75, 0, 75], [100, 0, 100])
    const held = [obstacle('other:0', 35, -7, 30, 14)]
    const placed = placeEdgeLabel(path, { width: 20, height: 12 }, [], {
      preferredDistance: 50,
      softObstacles: held,
    })

    expect(placed).not.toBeNull()
    expect(placed!.y).toBe(0)
    expect(edgeLabelRectsOverlap(edgeLabelRect(placed!, { width: 20, height: 12 }), held[0]!)).toBe(
      false,
    )
  })

  test('overlaps another label as little as possible rather than covering a card', () => {
    const path = samples([0, 0, 0], [50, 0, 50], [100, 0, 100])
    const card = obstacle('card', -40, -60, 180, 44)
    const held = [obstacle('other:0', -60, -12, 220, 24)]
    const placed = placeEdgeLabel(path, { width: 30, height: 14 }, [card], {
      preferredDistance: 50,
      softObstacles: held,
    })

    expect(placed).not.toBeNull()
    expect(edgeLabelRectsOverlap(edgeLabelRect(placed!, { width: 30, height: 14 }, 4), card)).toBe(
      false,
    )
  })

  test('lays parallel edges out so their names do not stack', () => {
    const size = { width: 60, height: 14 }
    const parallel = (y: number) =>
      samples(
        ...Array.from({ length: 21 }, (_, i) => [i * 10, y, i * 10] as [number, number, number]),
      )
    const placements = layoutEdgeLabels([
      {
        edgeId: 'prepares',
        slot: 0,
        samples: parallel(0),
        size,
        obstacles: [],
        preferredDistance: 100,
      },
      {
        edgeId: 'validates',
        slot: 0,
        samples: parallel(6),
        size,
        obstacles: [],
        preferredDistance: 100,
      },
      {
        edgeId: 'administers',
        slot: 0,
        samples: parallel(12),
        size,
        obstacles: [],
        preferredDistance: 100,
      },
    ])

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
    const path = samples([0, 0, 0], [50, 0, 50], [100, 0, 100], [150, 0, 150], [200, 0, 200])
    const a = { edgeId: 'a', slot: 0, samples: path, size, obstacles: [], preferredDistance: 100 }
    const b = { edgeId: 'b', slot: 0, samples: path, size, obstacles: [], preferredDistance: 100 }

    expect(layoutEdgeLabels([b, a])).toEqual(layoutEdgeLabels([a, b]))
    expect(layoutEdgeLabels([a, b]).get('a:0')).toMatchObject({ x: 80, y: -7 })
  })

  test('never lets a chip cover its own edge name', () => {
    const size = { width: 40, height: 14 }
    const path = samples(
      ...Array.from({ length: 11 }, (_, i) => [i * 10, 0, i * 10] as [number, number, number]),
    )
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
})
