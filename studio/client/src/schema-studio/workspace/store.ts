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

/** `list` with `item` removed if present, appended otherwise. */
function toggled(list: string[], item: string): string[] {
  const next = new Set(list)
  if (next.has(item)) next.delete(item)
  else next.add(item)
  return [...next]
}

/** `current` plus every entry of `positions` it lacks, or null when it lacks none. */
function withMissingPositions(
  current: Record<string, WorkspacePoint>,
  positions: Record<string, WorkspacePoint>,
): Record<string, WorkspacePoint> | null {
  const next = { ...current }
  let changed = false
  for (const [id, position] of Object.entries(positions)) {
    if (next[id]) continue
    next[id] = position
    changed = true
  }
  return changed ? next : null
}

export const useSchemaWorkspace = create<WorkspaceCanvasState>((set) => ({
  ...EMPTY,
  replaceDomains: (ids) => set({ visibleDomainIds: uniqueDomainIds(ids), initialized: true }),
  toggleDomain: (id) =>
    set((state) => ({ visibleDomainIds: toggled(state.visibleDomainIds, id), initialized: true })),
  setDomainPosition: (id, position) =>
    set((state) =>
      samePoint(state.domainPositions[id], position)
        ? state
        : { domainPositions: { ...state.domainPositions, [id]: position } },
    ),
  setExternalPosition: (origin, position) =>
    set((state) =>
      samePoint(state.externalPositions[origin], position)
        ? state
        : { externalPositions: { ...state.externalPositions, [origin]: position } },
    ),
  ensureDomainPositions: (positions) =>
    set((state) => {
      const domainPositions = withMissingPositions(state.domainPositions, positions)
      return domainPositions ? { domainPositions } : state
    }),
  resetWorkspaceFrames: () => set({ domainPositions: {}, externalPositions: {} }),
  toggleModule: (domainId, path) =>
    set((state) => ({
      collapsedModules: {
        ...state.collapsedModules,
        [domainId]: toggled(state.collapsedModules[domainId] ?? [], path),
      },
    })),
  toggleDomainExpanded: (domainId) =>
    set((state) => ({ expandedDomainIds: toggled(state.expandedDomainIds, domainId) })),
  toggleExternalExpanded: (origin) =>
    set((state) => ({ expandedExternals: toggled(state.expandedExternals, origin) })),
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
