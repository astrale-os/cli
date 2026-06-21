/**
 * layout.ts — persisted manual graph layout per domain. Positions are keyed by
 * node id (e.g. `class.Monitor`), so they survive schema changes: removed nodes'
 * positions are harmless, new nodes fall back to auto-layout. Stamped with the
 * schemaHash for reference. Persisted via the allow-listed store (layout.json).
 */
import { readJson, removeState, writeJson } from './store'

export interface NodePosition {
  x: number
  y: number
  /** persisted size — only expanded module containers carry one. */
  w?: number
  h?: number
}

export interface LayoutState {
  schemaHash?: string
  /** node id → manual position (only nodes the user has moved) */
  positions: Record<string, NodePosition>
}

const FILE = 'layout.json'

export function readLayout(root: string): LayoutState {
  return readJson<LayoutState>(root, FILE, { positions: {} })
}

export function saveLayout(
  root: string,
  positions: Record<string, NodePosition>,
  schemaHash?: string,
): LayoutState {
  const next: LayoutState = { schemaHash, positions }
  writeJson(root, FILE, next)
  return next
}

export function setNodePositions(
  root: string,
  updates: Record<string, NodePosition>,
  schemaHash?: string,
): LayoutState {
  const cur = readLayout(root)
  const next: LayoutState = {
    schemaHash: schemaHash ?? cur.schemaHash,
    positions: { ...cur.positions, ...updates },
  }
  writeJson(root, FILE, next)
  return next
}

export function resetLayout(root: string): void {
  removeState(root, FILE)
}
