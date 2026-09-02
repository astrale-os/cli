/** Machine-side UI state for one scanned workspace. */
import type {
  NodePosition,
  WorkspacePanelUiState,
  WorkspaceRailUiState,
  WorkspaceSchemaUiState,
  WorkspaceSection,
  WorkspaceUiState,
} from '../../shared/types'

import { asBoolean, asFiniteNumber, asJsonRecord, asString, asStringArray } from '../json'
import { readJson, writeJson } from './store'

const FILE = 'ui.json'
const SECTIONS = new Set<WorkspaceSection>(['schema', 'core', 'tests', 'process'])
const EDGE_STYLES = new Set<WorkspaceUiState['edgeStyle']>(['curved', 'orthogonal'])
const PANEL_TABS = new Set<WorkspacePanelUiState['tab']>(['agent', 'comments'])
const PANEL_SIDES = new Set<WorkspacePanelUiState['side']>(['left', 'right', 'bottom'])

export function emptyWorkspaceUiState(): WorkspaceUiState {
  return {
    version: 1,
    section: 'schema',
    edgeStyle: 'curved',
    panel: { open: false, tab: 'agent', side: 'bottom', size: 360 },
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
  const size = asFiniteNumber(record.size)
  return {
    open: asBoolean(record.open) ?? fallback.open,
    tab: oneOf(record.tab, PANEL_TABS) ?? fallback.tab,
    side: oneOf(record.side, PANEL_SIDES) ?? fallback.side,
    size: size === undefined ? fallback.size : Math.min(900, Math.max(260, Math.round(size))),
  }
}

function railState(value: unknown, fallback: WorkspaceRailUiState): WorkspaceRailUiState {
  const record = asJsonRecord(value)
  if (!record) return fallback
  const width = asFiniteNumber(record.width)
  return {
    width: width === undefined ? fallback.width : Math.min(560, Math.max(180, Math.round(width))),
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
    ...(readerDomainId ? { readerDomainId } : {}),
    panel: panelState(record.panel, fallback.panel),
    rail: railState(record.rail, fallback.rail),
    schema: schemaState(record.schema, fallback.schema),
  }
}

export function readWorkspaceUiState(root: string): WorkspaceUiState {
  return readJson(root, FILE, decodeWorkspaceUiState, emptyWorkspaceUiState())
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
    ...(readerDomainId ? { readerDomainId } : {}),
    panel: panelState(record.panel, current.panel),
    rail: railState(record.rail, current.rail),
    schema: schemaState(record.schema, current.schema),
  }
  writeJson(root, FILE, next)
  return next
}
