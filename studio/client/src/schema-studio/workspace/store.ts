import { create } from 'zustand'

import type { WorkspacePoint } from './geometry'

export type { WorkspacePoint, WorkspaceSize } from './geometry'

interface PersistedWorkspaceState {
  /** The domains the canvas draws. There is no second list: on the canvas or not. */
  selectedDomainIds: string[]
  /**
   * Whether a reader has ever composed this canvas. An empty selection is a legitimate
   * state — you took the last domain off — and only this tells it apart from a studio
   * that has never been opened, whose canvas opens on the domain you work in.
   */
  initialized: boolean
  domainPositions: Record<string, WorkspacePoint>
  externalPositions: Record<string, WorkspacePoint>
  collapsedModules: Record<string, string[]>
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
  toggleExternalExpanded: (origin: string) => void
}

const STORAGE_KEY = 'studio.schemaWorkspace.v1'

const EMPTY: PersistedWorkspaceState = {
  selectedDomainIds: [],
  initialized: false,
  domainPositions: {},
  externalPositions: {},
  collapsedModules: {},
  expandedExternals: [],
}

export function uniqueDomainIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

/**
 * What the canvas draws once you go and work in another domain.
 *
 * A canvas of one domain FOLLOWS you — that is the ordinary studio, and leaving the old
 * domain behind on screen would compose a workspace nobody asked for. A canvas of several
 * was composed on purpose, so the new domain joins it and nothing is taken away.
 *
 * The domain you leave is never put back on the canvas: taking it off was a choice, and
 * it outlives the fact that you happened to be working in it.
 */
export function selectionForActiveDomain(
  selectedDomainIds: string[],
  nextActiveDomainId: string,
): string[] {
  const selected = uniqueDomainIds(selectedDomainIds)
  if (selected.length <= 1) return [nextActiveDomainId]
  if (!selected.includes(nextActiveDomainId)) selected.push(nextActiveDomainId)
  return selected
}

/**
 * A canvas that used to carry two lists — what it held, and what of that it drew — now
 * carries one. What the reader had put away was not on screen, so it comes back off the
 * canvas rather than on it: the first paint after the upgrade is the last one they saw.
 */
export function migrateSelection(value: {
  selectedDomainIds?: string[]
  hiddenDomainIds?: string[]
}): string[] {
  const hidden = new Set(value.hiddenDomainIds ?? [])
  return uniqueDomainIds(value.selectedDomainIds ?? []).filter((id) => !hidden.has(id))
}

function load(): PersistedWorkspaceState {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<
      PersistedWorkspaceState & { hiddenDomainIds: string[] }
    > | null
    if (!value) return EMPTY
    return {
      selectedDomainIds: migrateSelection(value),
      // A stored canvas has been composed by definition, whatever the upgrade left in it.
      initialized: true,
      domainPositions: value.domainPositions ?? {},
      externalPositions: value.externalPositions ?? {},
      collapsedModules: value.collapsedModules ?? {},
      expandedExternals: value.expandedExternals ?? [],
    }
  } catch {
    return EMPTY
  }
}

function persist(state: PersistedWorkspaceState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
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

function persisted(state: WorkspaceCanvasState): PersistedWorkspaceState {
  return {
    selectedDomainIds: state.selectedDomainIds,
    initialized: state.initialized,
    domainPositions: state.domainPositions,
    externalPositions: state.externalPositions,
    collapsedModules: state.collapsedModules,
    expandedExternals: state.expandedExternals,
  }
}

const initial = load()

export const useSchemaWorkspace = create<WorkspaceCanvasState>((set) => ({
  ...initial,
  replaceDomains: (ids) =>
    set((state) => {
      const selectedDomainIds = uniqueDomainIds(ids)
      persist({ ...persisted(state), selectedDomainIds, initialized: true })
      return { selectedDomainIds, initialized: true }
    }),
  toggleDomain: (id) =>
    set((state) => {
      const selected = new Set(state.selectedDomainIds)
      if (selected.has(id)) selected.delete(id)
      else selected.add(id)
      const selectedDomainIds = [...selected]
      persist({ ...persisted(state), selectedDomainIds, initialized: true })
      return { selectedDomainIds, initialized: true }
    }),
  setDomainPosition: (id, position) =>
    set((state) => {
      if (samePoint(state.domainPositions[id], position)) return state
      const domainPositions = { ...state.domainPositions, [id]: position }
      persist({ ...persisted(state), domainPositions })
      return { domainPositions }
    }),
  setExternalPosition: (origin, position) =>
    set((state) => {
      if (samePoint(state.externalPositions[origin], position)) return state
      const externalPositions = { ...state.externalPositions, [origin]: position }
      persist({ ...persisted(state), externalPositions })
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
      persist({ ...persisted(state), domainPositions })
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
      persist({ ...persisted(state), externalPositions })
      return { externalPositions }
    }),
  resetWorkspaceFrames: () =>
    set((state) => {
      persist({ ...persisted(state), domainPositions: {}, externalPositions: {} })
      return { domainPositions: {}, externalPositions: {} }
    }),
  toggleModule: (domainId, path) =>
    set((state) => {
      const current = new Set(state.collapsedModules[domainId] ?? [])
      if (current.has(path)) current.delete(path)
      else current.add(path)
      const collapsedModules = { ...state.collapsedModules, [domainId]: [...current] }
      persist({ ...persisted(state), collapsedModules })
      return { collapsedModules }
    }),
  toggleExternalExpanded: (origin) =>
    set((state) => {
      const current = new Set(state.expandedExternals)
      if (current.has(origin)) current.delete(origin)
      else current.add(origin)
      const expandedExternals = [...current]
      persist({ ...persisted(state), expandedExternals })
      return { expandedExternals }
    }),
}))
