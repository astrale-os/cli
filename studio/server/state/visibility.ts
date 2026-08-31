/**
 * visibility.ts — persisted per-domain canvas visibility (the manual hide-set,
 * and inherited-edge category toggle). Sibling of
 * layout.ts: layout owns node POSITIONS, this owns what's SHOWN. All entries use
 * stable refs, so they survive schema edits (a removed ref is harmless).
 * Persisted via the allow-listed store (visibility.json).
 */
import type { VisibilityState } from '../../shared/types'

import { asBoolean, asJsonRecord } from '../json'
import { readJson, writeJson } from './store'

const FILE = 'visibility.json'
const DEFAULT: VisibilityState = {
  hidden: {},
  showInheritedEdges: true,
}

const defaultVisibility = (): VisibilityState => ({
  hidden: {},
  showInheritedEdges: DEFAULT.showInheritedEdges,
})

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
  }
}

export function normalizeVisibility(value: unknown): VisibilityState {
  return decodeVisibility(value) ?? defaultVisibility()
}

export function readVisibility(root: string): VisibilityState {
  return readJson(root, FILE, decodeVisibility, defaultVisibility())
}

export function saveVisibility(root: string, state: VisibilityState): VisibilityState {
  writeJson(root, FILE, state)
  return state
}
