import type { Node, Edge } from '@xyflow/react'

import dagre from 'dagre'

import type { LayoutDirection } from '@/lib/types'

import type { BusinessGraph } from './raw-to-business'

import { STRUCTURE_TYPE } from './kernel-fabric'

export interface BusinessNodeData extends Record<string, unknown> {
  nodeId: string
  className: string | null
  displayName: string
  path: string | null
  properties: Record<string, unknown>
  rawLabels: string[]
}

export interface BusinessEdgeData extends Record<string, unknown> {
  edgeId: string
  edgeType: string
  sourceId: string
  targetId: string
  properties: Record<string, unknown>
  reified: boolean
}

export type ClassColorEntry = {
  border: string
  header: string
  bg: string
  dot: string
  stroke: string
}

export const FIXED_CLASS_COLORS: Record<string, ClassColorEntry> = {
  Root: {
    border: 'border-zinc-700',
    header: 'bg-zinc-900',
    bg: 'bg-zinc-100 dark:bg-zinc-900/50',
    dot: 'bg-zinc-900',
    stroke: '#18181b',
  },
  Class: {
    border: 'border-amber-700',
    header: 'bg-amber-800',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    dot: 'bg-amber-800',
    stroke: '#92400e',
  },
  Interface: {
    border: 'border-emerald-400',
    header: 'bg-emerald-600',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    dot: 'bg-emerald-500',
    stroke: '#059669',
  },
  Operation: {
    border: 'border-rose-400',
    header: 'bg-rose-600',
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    dot: 'bg-rose-500',
    stroke: '#e11d48',
  },
  Domain: {
    border: 'border-red-500',
    header: 'bg-red-700',
    bg: 'bg-red-50 dark:bg-red-950/40',
    dot: 'bg-red-600',
    stroke: '#b91c1c',
  },
  has_parent: {
    border: 'border-zinc-300',
    header: 'bg-zinc-400',
    bg: 'bg-zinc-50 dark:bg-zinc-900/30',
    dot: 'bg-zinc-300',
    stroke: '#d4d4d8',
  },
}

const DYNAMIC_PALETTE: ClassColorEntry[] = [
  {
    border: 'border-blue-400',
    header: 'bg-blue-600',
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    dot: 'bg-blue-500',
    stroke: '#3b82f6',
  },
  {
    border: 'border-teal-400',
    header: 'bg-teal-600',
    bg: 'bg-teal-50 dark:bg-teal-950/40',
    dot: 'bg-teal-500',
    stroke: '#14b8a6',
  },
  {
    border: 'border-orange-400',
    header: 'bg-orange-600',
    bg: 'bg-orange-50 dark:bg-orange-950/40',
    dot: 'bg-orange-500',
    stroke: '#f97316',
  },
  {
    border: 'border-indigo-400',
    header: 'bg-indigo-600',
    bg: 'bg-indigo-50 dark:bg-indigo-950/40',
    dot: 'bg-indigo-500',
    stroke: '#6366f1',
  },
  {
    border: 'border-pink-400',
    header: 'bg-pink-600',
    bg: 'bg-pink-50 dark:bg-pink-950/40',
    dot: 'bg-pink-500',
    stroke: '#ec4899',
  },
  {
    border: 'border-cyan-400',
    header: 'bg-cyan-600',
    bg: 'bg-cyan-50 dark:bg-cyan-950/40',
    dot: 'bg-cyan-500',
    stroke: '#06b6d4',
  },
  {
    border: 'border-lime-400',
    header: 'bg-lime-600',
    bg: 'bg-lime-50 dark:bg-lime-950/40',
    dot: 'bg-lime-500',
    stroke: '#84cc16',
  },
  {
    border: 'border-fuchsia-400',
    header: 'bg-fuchsia-600',
    bg: 'bg-fuchsia-50 dark:bg-fuchsia-950/40',
    dot: 'bg-fuchsia-500',
    stroke: '#d946ef',
  },
  {
    border: 'border-sky-400',
    header: 'bg-sky-600',
    bg: 'bg-sky-50 dark:bg-sky-950/40',
    dot: 'bg-sky-500',
    stroke: '#0ea5e9',
  },
  {
    border: 'border-violet-400',
    header: 'bg-violet-600',
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    dot: 'bg-violet-500',
    stroke: '#8b5cf6',
  },
]

const UNTYPED_COLOR: ClassColorEntry = {
  border: 'border-zinc-400',
  header: 'bg-zinc-600',
  bg: 'bg-zinc-50 dark:bg-zinc-950/40',
  dot: 'bg-zinc-500',
  stroke: '#a1a1aa',
}

function slugHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function getClassColor(className: string | null): ClassColorEntry {
  if (!className) return UNTYPED_COLOR
  if (FIXED_CLASS_COLORS[className]) return FIXED_CLASS_COLORS[className]
  return DYNAMIC_PALETTE[slugHash(className) % DYNAMIC_PALETTE.length]
}

export function isFixedColor(className: string): boolean {
  return className in FIXED_CLASS_COLORS
}

const MIN_NODE_WIDTH = 80
const NODE_HEIGHT = 36
const NODE_H_PADDING = 20 // px-2.5 each side
const NODE_GAP = 6 // gap-1.5
const LABEL_CHAR_WIDTH = 5.5 // ~9px uppercase font
const NAME_CHAR_WIDTH = 6.5 // ~11px semibold font

function estimateNodeWidth(
  displayName: string,
  className: string | null,
  isFixedClass: boolean,
): number {
  let w = NODE_H_PADDING
  if (className && !isFixedClass) {
    w += className.length * LABEL_CHAR_WIDTH + NODE_GAP
  }
  w += displayName.length * NAME_CHAR_WIDTH
  return Math.max(MIN_NODE_WIDTH, Math.ceil(w))
}

export function businessToFlow(
  graph: BusinessGraph,
  direction: LayoutDirection = 'TB',
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  for (const bn of graph.nodes) {
    const data: BusinessNodeData = {
      nodeId: bn.id,
      className: bn.className,
      displayName: bn.displayName,
      path: bn.path,
      properties: bn.properties,
      rawLabels: bn.rawLabels,
    }
    nodes.push({
      id: `bn:${bn.id}`,
      type: 'businessNode',
      position: { x: 0, y: 0 },
      data,
    })
  }

  const HAS_PARENT = STRUCTURE_TYPE.hasParent

  for (const be of graph.edges) {
    const isHasParent = be.type === HAS_PARENT
    const data: BusinessEdgeData = {
      edgeId: be.id,
      edgeType: be.type,
      sourceId: be.sourceId,
      targetId: be.targetId,
      properties: be.properties,
      reified: be.reified,
    }
    edges.push({
      id: `be:${be.id}`,
      source: isHasParent ? `bn:${be.targetId}` : `bn:${be.sourceId}`,
      target: isHasParent ? `bn:${be.sourceId}` : `bn:${be.targetId}`,
      type: 'businessEdge',
      data,
    })
  }

  // Compute per-node widths for dagre
  const nodeWidths = new Map<string, number>()
  for (const bn of graph.nodes) {
    const fixed = bn.className ? isFixedColor(bn.className) : true
    const w = estimateNodeWidth(bn.displayName, bn.className, fixed)
    nodeWidths.set(`bn:${bn.id}`, w)
  }

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: 4, edgesep: 0, ranksep: 16, ranker: 'tight-tree' })

  for (const node of nodes) {
    g.setNode(node.id, { width: nodeWidths.get(node.id) ?? MIN_NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const be of graph.edges) {
    if (be.type === HAS_PARENT) {
      g.setEdge(`bn:${be.targetId}`, `bn:${be.sourceId}`)
    }
  }

  dagre.layout(g)

  // Build a position lookup (center coordinates) for handle computation
  const centers = new Map<string, { x: number; y: number; w: number }>()
  for (const node of nodes) {
    const pos = g.node(node.id)
    const w = nodeWidths.get(node.id) ?? MIN_NODE_WIDTH
    node.position = { x: pos.x - w / 2, y: pos.y - NODE_HEIGHT / 2 }
    centers.set(node.id, { x: pos.x, y: pos.y, w })
  }

  // Pick the best source/target handles based on relative node positions and layout direction.
  const halfH = NODE_HEIGHT / 2
  for (const edge of edges) {
    const src = centers.get(edge.source)
    const tgt = centers.get(edge.target)
    if (!src || !tgt) continue

    if (direction === 'LR') {
      // In LR mode: prefer left/right handles when nodes are clearly separated horizontally
      const halfWSrc = src.w / 2
      const halfWTgt = tgt.w / 2
      if (src.x + halfWSrc <= tgt.x - halfWTgt) {
        edge.sourceHandle = 'source-right'
        edge.targetHandle = 'target-left'
      } else if (tgt.x + halfWTgt <= src.x - halfWSrc) {
        edge.sourceHandle = 'source-left'
        edge.targetHandle = 'target-right'
      } else {
        // Same horizontal band → use vertical handles
        if (tgt.y >= src.y) {
          edge.sourceHandle = 'source-bottom'
          edge.targetHandle = 'target-top'
        } else {
          edge.sourceHandle = 'source-top'
          edge.targetHandle = 'target-bottom'
        }
      }
    } else {
      // In TB mode: prefer top/bottom handles when nodes are clearly separated vertically
      const srcBottom = src.y + halfH
      const srcTop = src.y - halfH
      const tgtBottom = tgt.y + halfH
      const tgtTop = tgt.y - halfH

      if (srcBottom <= tgtTop) {
        edge.sourceHandle = 'source-bottom'
        edge.targetHandle = 'target-top'
      } else if (tgtBottom <= srcTop) {
        edge.sourceHandle = 'source-top'
        edge.targetHandle = 'target-bottom'
      } else {
        const dx = tgt.x - src.x
        if (dx >= 0) {
          edge.sourceHandle = 'source-right'
          edge.targetHandle = 'target-left'
        } else {
          edge.sourceHandle = 'source-left'
          edge.targetHandle = 'target-right'
        }
      }
    }
  }

  return { nodes, edges }
}
