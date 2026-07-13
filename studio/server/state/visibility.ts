/**
 * visibility.ts — persisted per-domain canvas visibility (the manual hide-set,
 * inherited-edge category toggle, and materialized-interface set). Sibling of
 * layout.ts: layout owns node POSITIONS, this owns what's SHOWN. All entries use
 * stable refs, so they survive schema edits (a removed ref is harmless).
 * Persisted via the allow-listed store (visibility.json).
 */
import { readJson, removeState, writeJson } from './store'

export interface VisibilityState {
  hidden: Record<string, true>
  showInheritedEdges: boolean
  materializedInterfaces: Record<string, true>
}

const FILE = 'visibility.json'
const DEFAULT: VisibilityState = {
  hidden: {},
  showInheritedEdges: true,
  materializedInterfaces: {},
}

export function readVisibility(root: string): VisibilityState {
  // merge over DEFAULT so a file written before a field existed (e.g. pre-materialize)
  // still returns the complete shape — the client reads every field unconditionally.
  return { ...DEFAULT, ...readJson<Partial<VisibilityState>>(root, FILE, DEFAULT) }
}

export function saveVisibility(root: string, state: VisibilityState): VisibilityState {
  writeJson(root, FILE, state)
  return state
}

export function resetVisibility(root: string): VisibilityState {
  removeState(root, FILE)
  return DEFAULT
}
