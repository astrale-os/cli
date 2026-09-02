/**
 * cluster.ts — the "by class" reading of a data canvas.
 *
 * The automatic layout follows the edges, which is the right default for reading a flow but
 * scatters the members of one class across the canvas. This layout answers the other
 * question — what kinds of things are there, and how many of each — by gathering every card
 * of a class into one block, largest classes first, blocks flowing left to right and wrapping
 * like text. Pure: positions in, positions out.
 */
import type { Node } from '@xyflow/react'

import type { CoreNodeData } from './model'

export interface ClusterOptions {
  /** space between two cards of one block */
  gapX: number
  gapY: number
  /** space between two blocks, both axes */
  blockGap: number
  /** blocks wrap to a new row past this width */
  maxRowWidth: number
}

export const CLUSTER_DEFAULTS: ClusterOptions = {
  gapX: 28,
  gapY: 18,
  blockGap: 96,
  maxRowWidth: 1400,
}

const size = (node: Node, axis: 'width' | 'height', fallback: number): number => {
  const styled = node.style?.[axis]
  if (typeof styled === 'number' && styled > 0) return styled
  const measured = node.measured?.[axis]
  return typeof measured === 'number' && measured > 0 ? measured : fallback
}

/** The cards of one class, laid as a near-square grid; returns the block's footprint. */
function gridOf(
  members: Node[],
  options: ClusterOptions,
): { width: number; height: number; at: (index: number) => { x: number; y: number } } {
  const columns = Math.max(1, Math.ceil(Math.sqrt(members.length)))
  const cardWidth = Math.max(...members.map((node) => size(node, 'width', 184)))
  const cardHeight = Math.max(...members.map((node) => size(node, 'height', 50)))
  const rows = Math.ceil(members.length / columns)
  return {
    width: columns * cardWidth + (columns - 1) * options.gapX,
    height: rows * cardHeight + (rows - 1) * options.gapY,
    at: (index) => ({
      x: (index % columns) * (cardWidth + options.gapX),
      y: Math.floor(index / columns) * (cardHeight + options.gapY),
    }),
  }
}

export function clusterByClass(nodes: Node[], options: ClusterOptions = CLUSTER_DEFAULTS): Node[] {
  const byClass = new Map<string, Node[]>()
  for (const node of nodes) {
    const className = (node.data as CoreNodeData).className ?? ''
    byClass.set(className, [...(byClass.get(className) ?? []), node])
  }
  // biggest families first, ties by name, so the picture is stable across re-layouts
  const blocks = [...byClass.entries()].sort(
    ([leftName, left], [rightName, right]) =>
      right.length - left.length || leftName.localeCompare(rightName),
  )

  const placed = new Map<string, { x: number; y: number }>()
  let x = 0
  let y = 0
  let rowHeight = 0
  for (const [, members] of blocks) {
    const grid = gridOf(members, options)
    if (x > 0 && x + grid.width > options.maxRowWidth) {
      x = 0
      y += rowHeight + options.blockGap
      rowHeight = 0
    }
    members.forEach((node, index) => {
      const cell = grid.at(index)
      placed.set(node.id, { x: x + cell.x, y: y + cell.y })
    })
    x += grid.width + options.blockGap
    rowHeight = Math.max(rowHeight, grid.height)
  }

  return nodes.map((node) => {
    const position = placed.get(node.id)
    return position ? { ...node, position } : node
  })
}
