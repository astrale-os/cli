import { basename } from 'node:path'

/** Machine-side UI state for one scanned workspace. */
import type {
  NodePosition,
  WorkspacePanelUiState,
  WorkspaceRailUiState,
  WorkspaceSchemaUiState,
  WorkspaceSection,
  WorkspaceUiState,
} from '../../shared/types'

import { allDomains, type DomainHandle } from '../domain'
import { asBoolean, asFiniteNumber, asJsonRecord, asString, asStringArray } from '../json'
import { readJson, writeJson } from './store'

const FILE = 'ui.json'
const SECTIONS = new Set<WorkspaceSection>(['schema', 'core', 'tests', 'process'])
const EDGE_STYLES = new Set<WorkspaceUiState['edgeStyle']>(['curved', 'orthogonal'])
const PANEL_TABS = new Set<WorkspacePanelUiState['tab']>(['agent', 'comments'])
const PANEL_SIDES = new Set<WorkspacePanelUiState['side']>(['left', 'right', 'bottom'])
const DOCK_WIDTH = { min: 420, max: 1600, fallback: 880 }
const DOCK_HEIGHT = { min: 200, max: 1400, fallback: 560 }
const PANEL_SIZE = { min: 260, max: 900 }
const RAIL_WIDTH = { min: 180, max: 560 }
const DETAIL_WIDTH = { min: 320, max: 900, fallback: 420 }
/**
 * The dock's first default size. Every state saved since the dock became resizable
 * stores its size, so a workspace that never touched it holds exactly this pair: read
 * as the current default, it grows with it instead of staying on the old one forever.
 */
const FIRST_DOCK_DEFAULT = { width: 768, height: 480 }

function clamped(
  value: unknown,
  { min, max }: { min: number; max: number },
  fallback: number,
): number {
  const number = asFiniteNumber(value)
  return number === undefined ? fallback : Math.min(max, Math.max(min, Math.round(number)))
}

export function emptyWorkspaceUiState(): WorkspaceUiState {
  return {
    version: 1,
    section: 'schema',
    edgeStyle: 'curved',
    detailWidth: DETAIL_WIDTH.fallback,
    panel: {
      open: false,
      tab: 'agent',
      side: 'bottom',
      size: 360,
      dockWidth: DOCK_WIDTH.fallback,
      dockHeight: DOCK_HEIGHT.fallback,
    },
    rail: { width: 240, collapsed: false },
    schema: {
      visibleDomainIds: [],
      initialized: false,
      domainPositions: {},
      externalPositions: {},
      collapsedModules: {},
      expandedDomainIds: [],
      expandedExternals: [],
    },
  }
}

function oneOf<T extends string>(value: unknown, allowed: Set<T>): T | undefined {
  const candidate = asString(value) as T | undefined
  return candidate && allowed.has(candidate) ? candidate : undefined
}

function uniqueStrings(value: unknown, fallback: string[]): string[] {
  const items = asStringArray(value)
  return items ? [...new Set(items.filter(Boolean))] : fallback
}

function positions(value: unknown, fallback: Record<string, NodePosition>) {
  const record = asJsonRecord(value)
  if (!record) return fallback
  const result: Record<string, NodePosition> = {}
  for (const [key, raw] of Object.entries(record)) {
    const point = asJsonRecord(raw)
    const x = asFiniteNumber(point?.x)
    const y = asFiniteNumber(point?.y)
    if (!key || x === undefined || y === undefined) continue
    result[key] = { x, y }
  }
  return result
}

function collapsed(value: unknown, fallback: Record<string, string[]>) {
  const record = asJsonRecord(value)
  if (!record) return fallback
  const result: Record<string, string[]> = {}
  for (const [domainId, raw] of Object.entries(record)) {
    if (!domainId) continue
    const paths = asStringArray(raw)
    if (paths) result[domainId] = [...new Set(paths.filter(Boolean))]
  }
  return result
}

function schemaState(value: unknown, fallback: WorkspaceSchemaUiState): WorkspaceSchemaUiState {
  const record = asJsonRecord(value)
  if (!record) return fallback
  return {
    visibleDomainIds: uniqueStrings(record.visibleDomainIds, fallback.visibleDomainIds),
    initialized: asBoolean(record.initialized) ?? fallback.initialized,
    domainPositions: positions(record.domainPositions, fallback.domainPositions),
    externalPositions: positions(record.externalPositions, fallback.externalPositions),
    collapsedModules: collapsed(record.collapsedModules, fallback.collapsedModules),
    expandedDomainIds: uniqueStrings(record.expandedDomainIds, fallback.expandedDomainIds),
    expandedExternals: uniqueStrings(record.expandedExternals, fallback.expandedExternals),
  }
}

function panelState(value: unknown, fallback: WorkspacePanelUiState): WorkspacePanelUiState {
  const record = asJsonRecord(value)
  if (!record) return fallback
  const untouchedDock =
    record.dockWidth === FIRST_DOCK_DEFAULT.width && record.dockHeight === FIRST_DOCK_DEFAULT.height
  return {
    open: asBoolean(record.open) ?? fallback.open,
    tab: oneOf(record.tab, PANEL_TABS) ?? fallback.tab,
    side: oneOf(record.side, PANEL_SIDES) ?? fallback.side,
    size: clamped(record.size, PANEL_SIZE, fallback.size),
    // absent in states saved before the bottom dock could be resized
    dockWidth: untouchedDock
      ? DOCK_WIDTH.fallback
      : clamped(record.dockWidth, DOCK_WIDTH, fallback.dockWidth),
    dockHeight: untouchedDock
      ? DOCK_HEIGHT.fallback
      : clamped(record.dockHeight, DOCK_HEIGHT, fallback.dockHeight),
  }
}

function railState(value: unknown, fallback: WorkspaceRailUiState): WorkspaceRailUiState {
  const record = asJsonRecord(value)
  if (!record) return fallback
  return {
    width: clamped(record.width, RAIL_WIDTH, fallback.width),
    collapsed: asBoolean(record.collapsed) ?? fallback.collapsed,
  }
}

function decodeWorkspaceUiState(value: unknown): WorkspaceUiState | undefined {
  const record = asJsonRecord(value)
  if (!record || record.version !== 1) return undefined
  const fallback = emptyWorkspaceUiState()
  const readerDomainId = asString(record.readerDomainId)?.trim() || undefined
  return {
    version: 1,
    section: oneOf(record.section, SECTIONS) ?? fallback.section,
    edgeStyle: oneOf(record.edgeStyle, EDGE_STYLES) ?? fallback.edgeStyle,
    detailWidth: detailWidth(record.detailWidth),
    ...(readerDomainId ? { readerDomainId } : {}),
    panel: panelState(record.panel, fallback.panel),
    rail: railState(record.rail, fallback.rail),
    schema: schemaState(record.schema, fallback.schema),
  }
}

function detailWidth(value: unknown, fallback = DETAIL_WIDTH.fallback): number {
  return clamped(value, DETAIL_WIDTH, fallback)
}

export function readWorkspaceUiState(root: string): WorkspaceUiState {
  return remapWorkspaceDomainIds(
    readJson(root, FILE, decodeWorkspaceUiState, emptyWorkspaceUiState()),
    allDomains(),
  )
}

/** Keep existing canvas preferences when basename-only IDs become path-qualified IDs. */
export function remapWorkspaceDomainIds(
  state: WorkspaceUiState,
  domains: readonly Pick<DomainHandle, 'id' | 'root'>[],
): WorkspaceUiState {
  // The previous registry retained the last project for a duplicated basename.
  const aliases = new Map(
    domains.map(({ id, root }) => [basename(root).replace(/[^a-zA-Z0-9_-]/g, '-') || 'domain', id]),
  )
  const id = (value: string) => aliases.get(value) ?? value
  const list = (values: string[]) => [...new Set(values.map(id))]
  const keys = <T>(values: Record<string, T>): Record<string, T> =>
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [id(key), values[id(key)] ?? value]),
    )
  return {
    ...state,
    ...(state.readerDomainId ? { readerDomainId: id(state.readerDomainId) } : {}),
    schema: {
      ...state.schema,
      visibleDomainIds: list(state.schema.visibleDomainIds),
      expandedDomainIds: list(state.schema.expandedDomainIds),
      domainPositions: keys(state.schema.domainPositions),
      collapsedModules: keys(state.schema.collapsedModules),
    },
  }
}

/** Merge a trusted-boundary patch after decoding each field against the current state. */
export function updateWorkspaceUiState(root: string, patch: unknown): WorkspaceUiState {
  const current = readWorkspaceUiState(root)
  const record = asJsonRecord(patch)
  if (!record) return current
  const reader = record.readerDomainId
  const readerDomainId =
    reader === null ? undefined : asString(reader)?.trim() || current.readerDomainId
  const next: WorkspaceUiState = {
    version: 1,
    section: oneOf(record.section, SECTIONS) ?? current.section,
    edgeStyle: oneOf(record.edgeStyle, EDGE_STYLES) ?? current.edgeStyle,
    detailWidth: detailWidth(record.detailWidth, current.detailWidth),
    ...(readerDomainId ? { readerDomainId } : {}),
    panel: panelState(record.panel, current.panel),
    rail: railState(record.rail, current.rail),
    schema: schemaState(record.schema, current.schema),
  }
  writeJson(root, FILE, next)
  return next
}
