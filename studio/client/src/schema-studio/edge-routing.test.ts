import { routeSmartEdgeBatch } from '@tisoap/react-flow-smart-edge'
import { type Edge, type Node, Position } from '@xyflow/react'
import { describe, expect, test } from 'bun:test'

import {
  assignFloatingEdgePorts,
  edgeLabelObstacles,
  SMART_EDGE_RENDER_OPTIONS,
  type FloatingEdgePort,
} from './edge-routing'

const node = (
  id: string,
  x: number,
  y: number,
  width = 200,
  height = 44,
  parentId?: string,
): Node => ({
  id,
  position: { x, y },
  measured: { width, height },
  data: {},
  parentId,
})

const edge = (id: string, source: string, target: string, label = id): Edge => ({
  id,
  source,
  target,
  type: 'floating',
  data: { label },
})

const portOf = (value: Edge, end: 'source' | 'target'): FloatingEdgePort | undefined =>
  value.data?.[`${end}Port`] as FloatingEdgePort | undefined

const portsById = (edges: Edge[]) =>
  Object.fromEntries(
    edges.map((value) => [
      value.id,
      { source: portOf(value, 'source'), target: portOf(value, 'target') },
    ]),
  )

describe('floating-edge port assignment', () => {
  test('spreads a dense fan-in across available sides and unique border positions', () => {
    const target = node('target', 400, 116)
    const sources = Array.from({ length: 5 }, (_, index) =>
      node(`source-${index}`, 0, 100 + index * 8),
    )
    const routed = assignFloatingEdgePorts(
      [...sources, target],
      sources.map((source, index) => edge(`edge-${index}`, source.id, target.id)),
    )
    const targetPorts = routed.map((value) => portOf(value, 'target'))
    const leftPorts = targetPorts.filter((port) => port?.position === Position.Left)

    expect(leftPorts).toHaveLength(4)
    expect(new Set(leftPorts.map((port) => port?.offset)).size).toBe(4)
    expect(targetPorts.some((port) => port?.position !== Position.Left)).toBe(true)
  })

  test('uses the clear alternate side when congestion points at a neighbouring card', () => {
    const target = node('target', 400, 116)
    const blocker = node('blocker', 400, 52)
    const sources = Array.from({ length: 5 }, (_, index) =>
      node(`source-${index}`, 0, 84 + index * 4),
    )
    const routed = assignFloatingEdgePorts(
      [...sources, blocker, target],
      sources.map((source, index) => edge(`edge-${index}`, source.id, target.id)),
    )
    const targetPorts = routed.map((value) => portOf(value, 'target'))

    expect(targetPorts.filter((port) => port?.position === Position.Left)).toHaveLength(4)
    expect(targetPorts.some((port) => port?.position === Position.Top)).toBe(false)
    expect(targetPorts.some((port) => port?.position === Position.Bottom)).toBe(true)
  })

  test('is deterministic when the input edge order changes', () => {
    const nodes = [node('a', 0, 100), node('b', 400, 100), node('c', 400, 160)]
    const edges = [
      edge('z', 'a', 'b', 'third'),
      edge('a', 'a', 'b', 'first'),
      edge('m', 'a', 'b', 'second'),
      edge('c', 'a', 'c'),
    ]

    expect(portsById(assignFloatingEdgePorts(nodes, edges))).toEqual(
      portsById(assignFloatingEdgePorts(nodes, [...edges].reverse())),
    )
  })

  test('gives parallel relationships distinct ports at both ends', () => {
    const routed = assignFloatingEdgePorts(
      [node('a', 0, 0), node('b', 400, 0)],
      [edge('z', 'a', 'b', 'third'), edge('a', 'a', 'b', 'first'), edge('m', 'a', 'b', 'second')],
    )

    expect(new Set(routed.map((value) => portOf(value, 'source')?.offset)).size).toBe(3)
    expect(new Set(routed.map((value) => portOf(value, 'target')?.offset)).size).toBe(3)
  })

  test('uses horizontal sides for a mostly horizontal relationship between wide cards', () => {
    const routed = assignFloatingEdgePorts(
      [node('source', 0, 68), node('target', 280, 0)],
      [edge('shallow-diagonal', 'source', 'target')],
    )

    expect(portOf(routed[0]!, 'source')?.position).toBe(Position.Right)
    expect(portOf(routed[0]!, 'target')?.position).toBe(Position.Left)
  })

  test('resolves child positions relative to their parent before choosing a side', () => {
    const routed = assignFloatingEdgePorts(
      [
        node('group', 300, 0, 400, 300),
        node('child', 20, 100, 100, 40, 'group'),
        node('root', 50, 100, 100, 40),
      ],
      [edge('nested', 'child', 'root')],
    )

    expect(portOf(routed[0]!, 'source')?.position).toBe(Position.Left)
    expect(portOf(routed[0]!, 'target')?.position).toBe(Position.Right)
  })
})

describe('smart edge routing', () => {
  test('draws ordinary crossings without bridge hops', () => {
    expect(SMART_EDGE_RENDER_OPTIONS).not.toHaveProperty('hops')
  })

  test('routes around an intervening node instead of crossing it', () => {
    const result = routeSmartEdgeBatch(
      [
        node('source', 0, 0, 100, 40),
        node('blocker', 140, -10, 120, 60),
        node('target', 300, 0, 100, 40),
      ],
      [
        {
          id: 'blocked',
          source: 'source',
          target: 'target',
          sourceX: 100,
          sourceY: 20,
          targetX: 300,
          targetY: 20,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          preset: 'smoothstep',
          options: { gridRatio: 8, nodePadding: 10, borderRadius: 8 },
        },
      ],
    ).blocked

    expect(result?.kind).toBe('routed')
    if (result?.kind === 'routed') {
      expect(result.points.some(([, y]) => Math.abs(y - 20) > 1)).toBe(true)
    }
  })
})

describe('edge label obstacles', () => {
  test('blocks cards but leaves the usable body of an expanded module open', () => {
    const group = node('group', 100, 50, 400, 300)
    group.type = 'group'
    group.data = { collapsed: false }
    const child = node('child', 20, 80, 200, 44, 'group')
    child.type = 'classNode'

    const obstacles = edgeLabelObstacles([group, child])

    expect(obstacles).toContainEqual({
      id: 'group:header',
      x: 100,
      y: 50,
      width: 400,
      height: 32,
    })
    expect(obstacles).toContainEqual({
      id: 'child',
      x: 120,
      y: 130,
      width: 200,
      height: 44,
    })
    expect(
      obstacles.some(
        (obstacle) =>
          obstacle.x <= 250 &&
          obstacle.x + obstacle.width >= 250 &&
          obstacle.y <= 250 &&
          obstacle.y + obstacle.height >= 250,
      ),
    ).toBe(false)
  })

  test('blocks the complete rectangle of a collapsed module', () => {
    const group = node('group', 100, 50, 240, 44)
    group.type = 'group'
    group.data = { collapsed: true }

    expect(edgeLabelObstacles([group])).toEqual([
      { id: 'group', x: 100, y: 50, width: 240, height: 44 },
    ])
  })
})
