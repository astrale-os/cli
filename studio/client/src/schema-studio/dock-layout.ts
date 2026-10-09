/**
 * dock-layout.ts — where a domain's application and its loose Functions sit.
 *
 * ELK places what is wired: a class goes next to what it relates to, a bound view or
 * Function next to its class. What is wired to nothing has no place of its own in that
 * layout, so ELK scattered it wherever a gap remained. Those nodes are docked instead,
 * the same way every time: the application (the domain's unbound views) at the top left
 * of the domain, and right under it the unbound Functions, packed tight in one to three
 * columns depending on how many there are. The wired graph is laid out beside the dock.
 */
import type { Edge, Node } from '@xyflow/react'

import { elkLayout } from './elk-layout'
import { type Geometry, geometryOf, nodeSize } from './geometry'

/** Vertical gap between two docked pills: tight, they read as one list. */
export const DOCK_ROW_GAP = 8
/** Horizontal gap between two columns of Functions. */
export const DOCK_COLUMN_GAP = 16
/** Gap between the application and the Functions under it. */
export const DOCK_SECTION_GAP = 20
/** Gap between the dock and the wired graph laid out beside it. */
export const DOCK_GRAPH_GAP = 96

/** How many columns a list of `count` Functions is packed into. */
export function dockColumns(count: number): number {
  if (count <= 8) return 1
  if (count <= 20) return 2
  return 3
}

/** An unbound view or Function: wired to nothing, so ELK has nowhere to put it. */
export function isDocked(node: Node, wired: Set<string>): boolean {
  if (node.parentId) return false
  if (node.type !== 'viewNode' && node.type !== 'functionNode') return false
  return !wired.has(node.id)
}

function wiredIds(edges: Edge[]): Set<string> {
  const wired = new Set<string>()
  for (const edge of edges) {
    wired.add(edge.source)
    wired.add(edge.target)
  }
  return wired
}

const byId = (left: Node, right: Node) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)

/**
 * Place the docked nodes from the origin: views stacked first, then the Functions in
 * columns filled top to bottom, sorted by name so the same schema always lands the same.
 */
export function dockGeometry(docked: Node[]): { geometry: Geometry; w: number; h: number } {
  const views = docked.filter((node) => node.type === 'viewNode').sort(byId)
  const functions = docked.filter((node) => node.type === 'functionNode').sort(byId)
  const geometry: Geometry = {}
  let w = 0
  let y = 0

  for (const view of views) {
    const size = nodeSize(view)
    geometry[view.id] = { x: 0, y }
    y += size.h + DOCK_ROW_GAP
    w = Math.max(w, size.w)
  }
  if (views.length > 0 && functions.length > 0) y += DOCK_SECTION_GAP - DOCK_ROW_GAP

  const columns = dockColumns(functions.length)
  const rows = Math.ceil(functions.length / columns)
  const top = y
  let x = 0
  for (let column = 0; column < columns; column += 1) {
    const slice = functions.slice(column * rows, (column + 1) * rows)
    let columnW = 0
    y = top
    for (const fn of slice) {
      const size = nodeSize(fn)
      geometry[fn.id] = { x, y }
      y += size.h + DOCK_ROW_GAP
      columnW = Math.max(columnW, size.w)
    }
    w = Math.max(w, x + columnW)
    x += columnW + DOCK_COLUMN_GAP
  }

  const h = Math.max(0, ...docked.map((node) => geometry[node.id].y + nodeSize(node).h))
  return { geometry, w, h }
}

/** Lay a whole domain out: the dock at the top left, ELK's wired graph to its right. */
export async function layoutDomain(nodes: Node[], edges: Edge[]): Promise<Geometry> {
  const wired = wiredIds(edges)
  const docked = nodes.filter((node) => isDocked(node, wired))
  if (docked.length === 0) return geometryOf(await elkLayout(nodes, edges))

  const dockedIds = new Set(docked.map((node) => node.id))
  const rest = nodes.filter((node) => !dockedIds.has(node.id))
  const dock = dockGeometry(docked)
  if (rest.length === 0) return dock.geometry

  const laid = geometryOf(await elkLayout(rest, edges))
  const roots = rest.filter((node) => !node.parentId && laid[node.id])
  const minX = Math.min(...roots.map((node) => laid[node.id].x))
  const minY = Math.min(...roots.map((node) => laid[node.id].y))
  const shift = { x: dock.w + DOCK_GRAPH_GAP - minX, y: -minY }

  const geometry: Geometry = { ...dock.geometry }
  for (const node of rest) {
    const at = laid[node.id]
    if (!at) continue
    // Children are parent-relative: moving their box moves them.
    geometry[node.id] = node.parentId ? at : { ...at, x: at.x + shift.x, y: at.y + shift.y }
  }
  return geometry
}

/**
 * Place docked nodes that arrived after the domain was laid out: under the dock already
 * there, in its first column, rather than in the tray to the right of everything.
 * Returns only what it placed; anything it leaves out goes to the ordinary tray.
 */
export function packPendingDocked(
  placed: { node: Node; position: Geometry[string] }[],
  pending: Node[],
  edges: Edge[],
): Geometry {
  const wired = wiredIds(edges)
  const dock = placed.filter(({ node }) => isDocked(node, wired))
  const arriving = pending.filter((node) => isDocked(node, wired)).sort(byId)
  if (dock.length === 0 || arriving.length === 0) return {}

  const x = Math.min(...dock.map(({ position }) => position.x))
  let y = Math.max(...dock.map(({ node, position }) => position.y + nodeSize(node).h))
  const geometry: Geometry = {}
  for (const node of arriving) {
    y += DOCK_ROW_GAP
    geometry[node.id] = { x, y }
    y += nodeSize(node).h
  }
  return geometry
}
