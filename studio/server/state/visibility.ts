/**
 * visibility.ts — persisted per-domain canvas visibility (the manual hide-set +
 * the inherited-edge category toggle). Sibling of layout.ts: layout owns node
 * POSITIONS, this owns what's SHOWN. Both keyed only by stable refs, so they
 * survive schema edits (a removed ref's hidden flag is harmless). Persisted via
 * the allow-listed store (visibility.json).
 */
import { readJson, removeState, writeJson } from './store'

export interface VisibilityState {
  hidden: Record<string, true>
  showInheritedEdges: boolean
}

const FILE = 'visibility.json'
const DEFAULT: VisibilityState = { hidden: {}, showInheritedEdges: true }

export function readVisibility(root: string): VisibilityState {
  return readJson<VisibilityState>(root, FILE, DEFAULT)
}

export function saveVisibility(root: string, state: VisibilityState): VisibilityState {
  writeJson(root, FILE, state)
  return state
}

export function resetVisibility(root: string): VisibilityState {
  removeState(root, FILE)
  return DEFAULT
}
