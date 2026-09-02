import type { WorkspaceSchemaUiState } from '@shared/types'

import { create } from 'zustand'

import type { WorkspacePoint } from './geometry'

export type { WorkspacePoint, WorkspaceSize } from './geometry'

interface PersistedWorkspaceState extends WorkspaceSchemaUiState {
  /** The domains the canvas draws. There is no second list: on the canvas or not. */
  visibleDomainIds: string[]
  /**
   * Whether a reader has ever composed this canvas. An empty selection is a legitimate
   * state — you took the last domain off — and only this tells it apart from a studio
   * that has never been opened, whose canvas opens on the first discovered domain.
   */
  initialized: boolean
  domainPositions: Record<string, WorkspacePoint>
  externalPositions: Record<string, WorkspacePoint>
  collapsedModules: Record<string, string[]>
  /** Visible domain trees explicitly unfolded in the rail. */
  expandedDomainIds: string[]
  /** External frames the reader unfolded — see `expandedExternals` in the projection. */
  expandedExternals: string[]
}

interface WorkspaceCanvasState extends PersistedWorkspaceState {
  replaceDomains: (ids: string[]) => void
  toggleDomain: (id: string) => void
  setDomainPosition: (id: string, position: WorkspacePoint) => void
  setExternalPosition: (origin: string, position: WorkspacePoint) => void
  ensureDomainPositions: (positions: Record<string, WorkspacePoint>) => void
  ensureExternalPositions: (positions: Record<string, WorkspacePoint>) => void
  resetWorkspaceFrames: () => void
  toggleModule: (domainId: string, path: string) => void
  toggleDomainExpanded: (domainId: string) => void
  toggleExternalExpanded: (origin: string) => void
}

const EMPTY: PersistedWorkspaceState = {
  visibleDomainIds: [],
  initialized: false,
  domainPositions: {},
  externalPositions: {},
  collapsedModules: {},
  expandedDomainIds: [],
  expandedExternals: [],
}

export function uniqueDomainIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

/**
 * Every drag stop reports where its frame ended up, and all but a few leave it exactly
 * where it was. Writing that unchanged anchor anyway is not free: it re-composes the
 * canvas from a projection built BEFORE the drop, which paints the dropped node back at
 * its old position until the new projection lands a tick later.
 */
function samePoint(current: WorkspacePoint | undefined, next: WorkspacePoint): boolean {
  return current !== undefined && current.x === next.x && current.y === next.y
}

export function schemaWorkspaceSnapshot(
  state = useSchemaWorkspace.getState(),
): WorkspaceSchemaUiState {
  return {
    visibleDomainIds: state.visibleDomainIds,
    initialized: state.initialized,
    domainPositions: state.domainPositions,
    externalPositions: state.externalPositions,
    collapsedModules: state.collapsedModules,
    expandedDomainIds: state.expandedDomainIds,
    expandedExternals: state.expandedExternals,
  }
}

export const useSchemaWorkspace = create<WorkspaceCanvasState>((set) => ({
  ...EMPTY,
  replaceDomains: (ids) =>
    set(() => {
      const visibleDomainIds = uniqueDomainIds(ids)
      return { visibleDomainIds, initialized: true }
    }),
  toggleDomain: (id) =>
    set((state) => {
      const selected = new Set(state.visibleDomainIds)
      if (selected.has(id)) selected.delete(id)
      else selected.add(id)
      const visibleDomainIds = [...selected]
      return { visibleDomainIds, initialized: true }
    }),
  setDomainPosition: (id, position) =>
    set((state) => {
      if (samePoint(state.domainPositions[id], position)) return state
      const domainPositions = { ...state.domainPositions, [id]: position }
      return { domainPositions }
    }),
  setExternalPosition: (origin, position) =>
    set((state) => {
      if (samePoint(state.externalPositions[origin], position)) return state
      const externalPositions = { ...state.externalPositions, [origin]: position }
      return { externalPositions }
    }),
  ensureDomainPositions: (positions) =>
    set((state) => {
      const domainPositions = { ...state.domainPositions }
      let changed = false
      for (const [domainId, position] of Object.entries(positions)) {
        if (domainPositions[domainId]) continue
        domainPositions[domainId] = position
        changed = true
      }
      if (!changed) return state
      return { domainPositions }
    }),
  ensureExternalPositions: (positions) =>
    set((state) => {
      const externalPositions = { ...state.externalPositions }
      let changed = false
      for (const [origin, position] of Object.entries(positions)) {
        if (externalPositions[origin]) continue
        externalPositions[origin] = position
        changed = true
      }
      if (!changed) return state
      return { externalPositions }
    }),
  resetWorkspaceFrames: () =>
    set(() => {
      return { domainPositions: {}, externalPositions: {} }
    }),
  toggleModule: (domainId, path) =>
    set((state) => {
      const current = new Set(state.collapsedModules[domainId] ?? [])
      if (current.has(path)) current.delete(path)
      else current.add(path)
      const collapsedModules = { ...state.collapsedModules, [domainId]: [...current] }
      return { collapsedModules }
    }),
  toggleDomainExpanded: (domainId) =>
    set((state) => {
      const current = new Set(state.expandedDomainIds)
      if (current.has(domainId)) current.delete(domainId)
      else current.add(domainId)
      const expandedDomainIds = [...current]
      return { expandedDomainIds }
    }),
  toggleExternalExpanded: (origin) =>
    set((state) => {
      const current = new Set(state.expandedExternals)
      if (current.has(origin)) current.delete(origin)
      else current.add(origin)
      const expandedExternals = [...current]
      return { expandedExternals }
    }),
}))

/** Install the server-owned state without replacing the store's actions. */
export function hydrateSchemaWorkspace(state: WorkspaceSchemaUiState): void {
  useSchemaWorkspace.setState({
    visibleDomainIds: uniqueDomainIds(state.visibleDomainIds),
    initialized: state.initialized,
    domainPositions: state.domainPositions,
    externalPositions: state.externalPositions,
    collapsedModules: state.collapsedModules,
    expandedDomainIds: uniqueDomainIds(state.expandedDomainIds),
    expandedExternals: state.expandedExternals,
  })
}
