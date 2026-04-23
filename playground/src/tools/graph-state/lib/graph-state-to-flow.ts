import type { Node, Edge } from '@xyflow/react'

import dagre from 'dagre'

import type { GraphStateData, LayoutDirection } from '@/lib/types'

export interface GraphNodeData extends Record<string, unknown> {
  nodeId: string
  labels: string[]
  properties: Record<string, unknown>
}

export interface GraphEdgeData extends Record<string, unknown> {
  edgeType: string
  src: string
  dest: string
  properties: Record<string, unknown>
}

const NODE_COLORS = [
  { border: 'border-teal-400', header: 'bg-teal-600', bg: 'bg-teal-50 dark:bg-teal-950/40' },
  {
    border: 'border-orange-400',
    header: 'bg-orange-600',
    bg: 'bg-orange-50 dark:bg-orange-950/40',
  },
  {
    border: 'border-indigo-400',
    header: 'bg-indigo-600',
    bg: 'bg-indigo-50 dark:bg-indigo-950/40',
  },
  { border: 'border-pink-400', header: 'bg-pink-600', bg: 'bg-pink-50 dark:bg-pink-950/40' },
  { border: 'border-lime-400', header: 'bg-lime-600', bg: 'bg-lime-50 dark:bg-lime-950/40' },
  { border: 'border-sky-400', header: 'bg-sky-600', bg: 'bg-sky-50 dark:bg-sky-950/40' },
]

export function getLabelColor(label: string) {
  let hash = 0
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0
  }
  return NODE_COLORS[Math.abs(hash) % NODE_COLORS.length]
}

const NODE_WIDTH = 180
const NODE_HEIGHT = 40

export function graphStateToFlow(
  data: GraphStateData,
  filter?: { labels?: Set<string> },
  direction: LayoutDirection = 'TB',
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const nodeIds = new Set<string>()

  for (const raw of data.nodes) {
    if (filter?.labels && filter.labels.size > 0) {
      const nodeLabels = raw.labels ?? []
      if (!nodeLabels.some((l) => filter.labels!.has(l))) continue
    }

    const { id, labels, _labels, ...rest } = raw as Record<string, unknown>
    const properties: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rest)) {
      if (k !== 'n') properties[k] = v
    }

    const nodeData: GraphNodeData = {
      nodeId: id as string,
      labels: (labels as string[]) ?? [],
      properties,
    }

    nodes.push({
      id: `gn:${id}`,
      type: 'graphStateNode',
      position: { x: 0, y: 0 },
      data: nodeData,
    })
    nodeIds.add(id as string)
  }

  const UPWARD_EDGES = new Set([
    'has_parent',
    'hasParent',
    'of_domain',
    'method_of',
    'instance_of',
    'implements',
    'extends',
  ])

  for (const raw of data.edges) {
    if (!nodeIds.has(raw.src) || !nodeIds.has(raw.dest)) continue

    const flip = UPWARD_EDGES.has(raw.type)

    const edgeData: GraphEdgeData = {
      edgeType: raw.type,
      src: raw.src,
      dest: raw.dest,
      properties: raw.props ?? {},
    }

    edges.push({
      id: `ge:${raw.type}:${raw.src}:${raw.dest}`,
      source: flip ? `gn:${raw.dest}` : `gn:${raw.src}`,
      target: flip ? `gn:${raw.src}` : `gn:${raw.dest}`,
      type: 'graphStateEdge',
      data: edgeData,
    })
  }

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 80 })

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of edges) {
    const d = edge.data as GraphEdgeData
    if (d.edgeType === 'has_parent' || d.edgeType === 'hasParent') {
      g.setEdge(edge.source, edge.target)
    }
  }

  dagre.layout(g)

  for (const node of nodes) {
    const pos = g.node(node.id)
    node.position = { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 }
  }

  return { nodes, edges }
}
