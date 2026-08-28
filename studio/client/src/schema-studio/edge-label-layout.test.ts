import { describe, expect, test } from 'bun:test'

import {
  createEdgeLabelObstacleIndex,
  edgeLabelRect,
  edgeLabelRectsOverlap,
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
})
