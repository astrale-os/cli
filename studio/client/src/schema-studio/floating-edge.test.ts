import type { Edge } from '@xyflow/react'

import { describe, expect, test } from 'bun:test'

import { parallelEdgePath, separateParallelEdges } from './floating-edge'

const edge = (id: string, source: string, target: string, label = id): Edge => ({
  id,
  source,
  target,
  type: 'floating',
  data: { label },
})

const laneOf = (value: Edge) => ({
  count: value.data?.parallelCount,
  offset: value.data?.parallelOffset,
})

describe('parallel floating-edge lanes', () => {
  test('fans same-direction edges into stable symmetric lanes', () => {
    const routed = separateParallelEdges([
      edge('z', 'class.A', 'class.B', 'third'),
      edge('a', 'class.A', 'class.B', 'first'),
      edge('m', 'class.A', 'class.B', 'second'),
    ])

    expect(Object.fromEntries(routed.map((value) => [value.id, laneOf(value)]))).toEqual({
      z: { count: 3, offset: 32 },
      a: { count: 3, offset: -32 },
      m: { count: 3, offset: 0 },
    })
  })

  test('groups reciprocal edges by unordered endpoints without putting them on one physical lane', () => {
    const routed = separateParallelEdges([
      edge('forward', 'class.A', 'class.B'),
      edge('reverse', 'class.B', 'class.A'),
    ])

    expect(laneOf(routed[0])).toEqual({ count: 2, offset: -16 })
    expect(laneOf(routed[1])).toEqual({ count: 2, offset: -16 })
    expect(parallelEdgePath({ sx: 0, sy: 0, tx: 100, ty: 0, offset: -16 }).slice(1)).toEqual([
      50, -16,
    ])
    expect(parallelEdgePath({ sx: 100, sy: 0, tx: 0, ty: 0, offset: -16 }).slice(1)).toEqual([
      50, 16,
    ])
  })

  test('does not alter a floating edge with no parallel peer', () => {
    const single = edge('single', 'class.A', 'class.B')
    expect(separateParallelEdges([single])[0]).toBe(single)
  })

  test('does not group edges that only share one endpoint', () => {
    const first = edge('first', 'class.A', 'class.B')
    const second = edge('second', 'class.A', 'class.C')
    const routed = separateParallelEdges([first, second])
    expect(routed[0]).toBe(first)
    expect(routed[1]).toBe(second)
  })
})
