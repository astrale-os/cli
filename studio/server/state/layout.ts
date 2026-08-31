/**
 * layout.ts — persisted manual graph layout per domain. Positions are keyed by
 * node id (e.g. `class.Monitor`), so they survive schema changes: removed nodes'
 * positions are harmless, new nodes fall back to auto-layout. Stamped with the
 * render fingerprint for reference. Persisted via the allow-listed store
 * (layout.json).
 */
import type { LayoutState, NodePosition } from '../../shared/types'

import { asFiniteNumber, asJsonRecord, asString } from '../json'
import { readJson, removeState, writeJson } from './store'

const FILE = 'layout.json'

interface StoredLayout extends LayoutState {
  schemaHash?: string
}

function decodePosition(value: unknown): NodePosition | undefined {
  const record = asJsonRecord(value)
  const x = asFiniteNumber(record?.x)
  const y = asFiniteNumber(record?.y)
  if (x === undefined || y === undefined) return undefined
  const w = asFiniteNumber(record?.w)
  const h = asFiniteNumber(record?.h)
  return { x, y, ...(w === undefined ? {} : { w }), ...(h === undefined ? {} : { h }) }
}

export function decodeNodePositions(value: unknown): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {}
  for (const [id, candidate] of Object.entries(asJsonRecord(value) ?? {})) {
    const position = decodePosition(candidate)
    if (position) positions[id] = position
  }
  return positions
}

function decodeStoredLayout(value: unknown): StoredLayout | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  const positions = decodeNodePositions(record.positions)
  const renderFingerprint = asString(record.renderFingerprint)
  const schemaHash = asString(record.schemaHash)
  return {
    positions,
    ...(renderFingerprint === undefined ? {} : { renderFingerprint }),
    ...(schemaHash === undefined ? {} : { schemaHash }),
  }
}

export function readLayout(root: string): LayoutState {
  const stored = readJson(root, FILE, decodeStoredLayout, { positions: {} })
  return {
    ...((stored.renderFingerprint ?? stored.schemaHash)
      ? { renderFingerprint: stored.renderFingerprint ?? stored.schemaHash }
      : {}),
    positions: stored.positions ?? {},
  }
}

export function saveLayout(
  root: string,
  positions: Record<string, NodePosition>,
  renderFingerprint?: string,
): LayoutState {
  const next: LayoutState = { renderFingerprint, positions }
  writeJson(root, FILE, next)
  return next
}

export function setNodePositions(
  root: string,
  updates: Record<string, NodePosition>,
  renderFingerprint?: string,
): LayoutState {
  const cur = readLayout(root)
  const next: LayoutState = {
    renderFingerprint: renderFingerprint ?? cur.renderFingerprint,
    positions: { ...cur.positions, ...updates },
  }
  writeJson(root, FILE, next)
  return next
}

export function resetLayout(root: string): void {
  removeState(root, FILE)
}
