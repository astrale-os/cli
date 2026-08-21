/**
 * visibility.ts — persisted per-domain canvas visibility (the manual hide-set,
 * inherited-edge category toggle, and materialized-interface set). Sibling of
 * layout.ts: layout owns node POSITIONS, this owns what's SHOWN. All entries use
 * stable refs, so they survive schema edits (a removed ref is harmless).
 * Persisted via the allow-listed store (visibility.json).
 */
import type { VisibilityState } from '../../shared/types'

import { asBoolean, asJsonRecord } from '../json'
import { readJson, removeState, writeJson } from './store'

const FILE = 'visibility.json'
const DEFAULT: VisibilityState = {
  hidden: {},
  showInheritedEdges: true,
  materializedInterfaces: {},
}

function trueSet(value: unknown): Record<string, true> {
  return Object.fromEntries(
    Object.entries(asJsonRecord(value) ?? {}).filter(
      (entry): entry is [string, true] => entry[1] === true,
    ),
  )
}

function decodeVisibility(value: unknown): VisibilityState | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  return {
    hidden: trueSet(record.hidden),
    showInheritedEdges: asBoolean(record.showInheritedEdges) ?? DEFAULT.showInheritedEdges,
    materializedInterfaces: trueSet(record.materializedInterfaces),
  }
}

export function readVisibility(root: string): VisibilityState {
  // merge over DEFAULT so a file written before a field existed (e.g. pre-materialize)
  // still returns the complete shape — the client reads every field unconditionally.
  return readJson(root, FILE, decodeVisibility, { ...DEFAULT })
}

export function saveVisibility(root: string, state: VisibilityState): VisibilityState {
  writeJson(root, FILE, state)
  return state
}

export function resetVisibility(root: string): VisibilityState {
  removeState(root, FILE)
  return DEFAULT
}
