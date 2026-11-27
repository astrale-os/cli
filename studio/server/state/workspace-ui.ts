/**
 * Machine-side UI state for one scanned workspace (`ui.json`). The file is read whole or not at
 * all (state-file.ts): a version or a value this Studio does not read makes it unreadable, and
 * no write goes over it; a key it does not know is kept. A value out of its range is brought
 * back into it, which is the same preference, not a lost one.
 */
import type {
  WorkspacePanelUiState,
  WorkspaceRailUiState,
  WorkspaceUiState,
} from '../../shared/contracts/workspace'

import { WORKSPACE_UI_LIMITS } from '../../shared/contracts/workspace'
import { asBoolean, asFiniteNumber, asJsonRecord, asString, refused, type Decoded } from '../json'
import { changeStateFile, stateOf, type StateFile } from './state-file'
const EDGE_STYLES = new Set<WorkspaceUiState['edgeStyle']>(['curved', 'orthogonal'])
const PANEL_TABS = new Set<WorkspacePanelUiState['tab']>(['agent', 'comments'])
const PANEL_SIDES = new Set<WorkspacePanelUiState['side']>(['left', 'right', 'bottom'])
const DOCK_WIDTH = { min: 420, max: 1600, fallback: 880 }
const DOCK_HEIGHT = { min: 200, max: 1400, fallback: 560 }
const PANEL_SIZE = { min: 260, max: 900 }
const RAIL_WIDTH = { min: 180, max: 560 }
const DETAIL_WIDTH = { min: 320, max: 900, fallback: 420 }

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
  }
}

function oneOf<T extends string>(value: unknown, allowed: Set<T>): T | undefined {
  const candidate = asString(value) as T | undefined
  return candidate && allowed.has(candidate) ? candidate : undefined
}

function panelState(value: unknown, fallback: WorkspacePanelUiState): WorkspacePanelUiState {
  const record = asJsonRecord(value)
  if (!record) return fallback
  return {
    open: asBoolean(record.open) ?? fallback.open,
    tab: oneOf(record.tab, PANEL_TABS) ?? fallback.tab,
    side: oneOf(record.side, PANEL_SIDES) ?? fallback.side,
    size: clamped(record.size, PANEL_SIZE, fallback.size),
    dockWidth: clamped(record.dockWidth, DOCK_WIDTH, fallback.dockWidth),
    dockHeight: clamped(record.dockHeight, DOCK_HEIGHT, fallback.dockHeight),
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

/** Absent, or one of `allowed`; else why not. */
function checkedOneOf(value: unknown, allowed: Set<string>, what: string): string | undefined {
  return value === undefined || (typeof value === 'string' && allowed.has(value))
    ? undefined
    : `its ${what} is none of ${[...allowed].join(', ')}`
}
const checkedNumber = (value: unknown, what: string) =>
  value === undefined || asFiniteNumber(value) !== undefined
    ? undefined
    : `its ${what} is not a number`
const checkedBoolean = (value: unknown, what: string) =>
  value === undefined || typeof value === 'boolean' ? undefined : `its ${what} is not true or false`

/** Why the file is not this Studio's UI state, read whole; nothing when it is. */
function problemOf(record: Record<string, unknown>): string | undefined {
  if (record.version !== 1)
    return `it is version ${JSON.stringify(record.version)}, and this Studio reads version 1`
  const { readerDomainId } = record
  if (readerDomainId !== undefined && typeof readerDomainId !== 'string')
    return 'its reader Domain is not text'
  if (
    typeof readerDomainId === 'string' &&
    readerDomainId.length > WORKSPACE_UI_LIMITS.readerDomainId
  )
    return `its reader Domain is longer than ${WORKSPACE_UI_LIMITS.readerDomainId} characters`
  const panel = record.panel === undefined ? {} : asJsonRecord(record.panel)
  const rail = record.rail === undefined ? {} : asJsonRecord(record.rail)
  if (!panel) return 'its panel is not an object'
  if (!rail) return 'its rail is not an object'
  return (
    checkedOneOf(record.edgeStyle, EDGE_STYLES, 'edge style') ??
    checkedNumber(record.detailWidth, 'detail width') ??
    checkedBoolean(panel.open, 'panel’s open state') ??
    checkedOneOf(panel.tab, PANEL_TABS, 'panel tab') ??
    checkedOneOf(panel.side, PANEL_SIDES, 'panel side') ??
    checkedNumber(panel.size, 'panel size') ??
    checkedNumber(panel.dockWidth, 'dock width') ??
    checkedNumber(panel.dockHeight, 'dock height') ??
    checkedNumber(rail.width, 'rail width') ??
    checkedBoolean(rail.collapsed, 'rail’s collapsed state')
  )
}

function workspaceUiStateOf(value: unknown): Decoded<WorkspaceUiState> {
  const record = asJsonRecord(value)
  if (!record) return refused('it holds no object')
  const problem = problemOf(record)
  if (problem) return refused(problem)
  const fallback = emptyWorkspaceUiState()
  const readerDomainId = asString(record.readerDomainId)?.trim() || undefined
  return {
    value: {
      version: 1,
      edgeStyle: oneOf(record.edgeStyle, EDGE_STYLES) ?? fallback.edgeStyle,
      detailWidth: detailWidth(record.detailWidth),
      ...(readerDomainId ? { readerDomainId } : {}),
      panel: panelState(record.panel, fallback.panel),
      rail: railState(record.rail, fallback.rail),
    },
  }
}

function detailWidth(value: unknown, fallback = DETAIL_WIDTH.fallback): number {
  return clamped(value, DETAIL_WIDTH, fallback)
}

const WORKSPACE_UI: StateFile<WorkspaceUiState> = {
  name: 'ui.json',
  decode: workspaceUiStateOf,
  shape: {
    record: {
      version: null,
      edgeStyle: null,
      detailWidth: null,
      readerDomainId: null,
      panel: {
        record: {
          open: null,
          tab: null,
          side: null,
          size: null,
          dockWidth: null,
          dockHeight: null,
        },
      },
      rail: { record: { width: null, collapsed: null } },
    },
  },
  empty: emptyWorkspaceUiState,
}

/** The workspace's UI state; `UnreadableState` when the file is not read whole. */
export function readWorkspaceUiState(root: string): WorkspaceUiState {
  return stateOf(root, WORKSPACE_UI)
}

/**
 * Merge a trusted-boundary patch after decoding each field against the current state: a field
 * that does not decode keeps what the state had; a reader Domain past
 * `WORKSPACE_UI_LIMITS.readerDomainId` is refused (413).
 */
export function updateWorkspaceUiState(
  root: string,
  patch: unknown,
): { readonly value: WorkspaceUiState } | { readonly problem: string; readonly tooLarge: true } {
  const record = asJsonRecord(patch)
  const reader = record?.readerDomainId
  if (typeof reader === 'string' && reader.length > WORKSPACE_UI_LIMITS.readerDomainId)
    return {
      problem: `a reader Domain id is at most ${WORKSPACE_UI_LIMITS.readerDomainId} characters`,
      tooLarge: true,
    }
  const value = changeStateFile(root, WORKSPACE_UI, (current): WorkspaceUiState | undefined => {
    if (!record) return undefined
    const readerDomainId =
      reader === null ? undefined : asString(reader)?.trim() || current.readerDomainId
    return {
      version: 1,
      edgeStyle: oneOf(record.edgeStyle, EDGE_STYLES) ?? current.edgeStyle,
      detailWidth: detailWidth(record.detailWidth, current.detailWidth),
      ...(readerDomainId ? { readerDomainId } : {}),
      panel: panelState(record.panel, current.panel),
      rail: railState(record.rail, current.rail),
    }
  })
  return { value }
}
