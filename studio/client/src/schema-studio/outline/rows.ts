/**
 * The outline as the rows a reader sees, and where each key moves the focus. Pure:
 * `useOutline` holds the state and feeds it here.
 */
import type { OutlineNode } from './model'

export interface OutlineRow {
  node: OutlineNode
  /** 1-based, as `aria-level` reads it. */
  level: number
  parentId?: string
  /** 1-based place among its siblings, and their count: `aria-posinset`, `aria-setsize`. */
  position: number
  setSize: number
  expandable: boolean
  expanded: boolean
  /** The home row of the selected target. */
  selected: boolean
  /** A reference row that points at the selected target. */
  current: boolean
}

export interface RowState {
  isExpanded: (node: OutlineNode) => boolean
  selected?: string
  /** Rows whose label or detail holds it, with their ancestors; empty shows everything. */
  filter?: string
}

function matches(node: OutlineNode, needle: string): boolean {
  return (
    node.label.toLocaleLowerCase().includes(needle) ||
    (node.detail?.toLocaleLowerCase().includes(needle) ?? false)
  )
}

/** The visible rows, depth first. A filter opens every ancestor of a match. */
export function outlineRows(nodes: readonly OutlineNode[], state: RowState): OutlineRow[] {
  const needle = state.filter?.trim().toLocaleLowerCase() ?? ''
  const rows: OutlineRow[] = []

  // With a filter, a node shows when it or a descendant matches.
  const shown = new Map<string, boolean>()
  const keep = (node: OutlineNode): boolean => {
    const known = shown.get(node.id)
    if (known !== undefined) return known
    let kept = matches(node, needle)
    for (const child of node.children) kept = keep(child) || kept
    shown.set(node.id, kept)
    return kept
  }

  const visit = (siblings: readonly OutlineNode[], level: number, parentId?: string) => {
    const visible = needle ? siblings.filter(keep) : siblings
    visible.forEach((node, index) => {
      const expandable = node.children.length > 0
      const expanded = expandable && (needle ? node.children.some(keep) : state.isExpanded(node))
      rows.push({
        node,
        level,
        ...(parentId ? { parentId } : {}),
        position: index + 1,
        setSize: visible.length,
        expandable,
        expanded,
        selected: !node.reference && node.target !== undefined && node.target === state.selected,
        current: !!node.reference && node.target !== undefined && node.target === state.selected,
      })
      if (expanded) visit(node.children, level + 1, node.id)
    })
  }
  visit(nodes, 1)
  return rows
}

/** The nodes above the home node of `target`, outermost first. */
export function ancestorsOf(
  nodes: readonly OutlineNode[],
  target: string,
): OutlineNode[] | undefined {
  for (const node of nodes) {
    if (!node.reference && node.target === target) return []
    const below = ancestorsOf(node.children, target)
    if (below) return [node, ...below]
  }
  return undefined
}

export type OutlineMove =
  | { focus: string }
  | { expand: string }
  | { collapse: string }
  | { expandSiblings: string[] }
  | { select: string }

/**
 * The ARIA tree keys: arrows walk and fold, Home/End jump, Enter and Space select,
 * `*` opens the focused row's siblings. Anything else moves nothing.
 */
export function moveFor(
  rows: readonly OutlineRow[],
  focused: string | undefined,
  key: string,
): OutlineMove | undefined {
  if (rows.length === 0) return undefined
  const index = rows.findIndex((row) => row.node.id === focused)
  const row = rows[index]
  if (!row) return { focus: rows[0]!.node.id }
  switch (key) {
    case 'ArrowDown':
      return index < rows.length - 1 ? { focus: rows[index + 1]!.node.id } : undefined
    case 'ArrowUp':
      return index > 0 ? { focus: rows[index - 1]!.node.id } : undefined
    case 'ArrowRight':
      if (!row.expandable) return undefined
      return row.expanded ? { focus: rows[index + 1]!.node.id } : { expand: row.node.id }
    case 'ArrowLeft':
      if (row.expanded) return { collapse: row.node.id }
      return row.parentId ? { focus: row.parentId } : undefined
    case 'Home':
      return { focus: rows[0]!.node.id }
    case 'End':
      return { focus: rows.at(-1)!.node.id }
    case 'Enter':
    case ' ':
      return { select: row.node.id }
    case '*':
      return {
        expandSiblings: rows
          .filter((other) => other.parentId === row.parentId && other.expandable)
          .map((other) => other.node.id),
      }
    default:
      return undefined
  }
}

/**
 * Type-ahead: the first row from the focused one whose label starts with `prefix`.
 * A single letter moves past the focused row, so pressing it again cycles.
 */
export function rowStartingWith(
  rows: readonly OutlineRow[],
  focused: string | undefined,
  prefix: string,
): string | undefined {
  const needle = prefix.toLocaleLowerCase()
  const start = rows.findIndex((row) => row.node.id === focused)
  for (let step = prefix.length > 1 ? 0 : 1; step <= rows.length; step += 1) {
    const row = rows[(start + step + rows.length) % rows.length]!
    if (row.node.label.toLocaleLowerCase().startsWith(needle)) return row.node.id
  }
  return undefined
}
