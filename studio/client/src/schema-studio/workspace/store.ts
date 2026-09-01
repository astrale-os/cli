import { create } from 'zustand'

import type { WorkspacePoint } from './geometry'

export type { WorkspacePoint, WorkspaceSize } from './geometry'

interface PersistedWorkspaceState {
  selectedDomainIds: string[]
  domainPositions: Record<string, WorkspacePoint>
  externalPositions: Record<string, WorkspacePoint>
  collapsedModules: Record<string, string[]>
}

interface WorkspaceCanvasState extends PersistedWorkspaceState {
  replaceDomains: (ids: string[]) => void
  toggleDomain: (id: string, primaryDomainId: string) => void
  setDomainPosition: (id: string, position: WorkspacePoint) => void
  setExternalPosition: (origin: string, position: WorkspacePoint) => void
  ensureDomainPositions: (positions: Record<string, WorkspacePoint>) => void
  ensureExternalPositions: (positions: Record<string, WorkspacePoint>) => void
  resetWorkspaceFrames: () => void
  toggleModule: (domainId: string, path: string) => void
}

const STORAGE_KEY = 'studio.schemaWorkspace.v1'

const EMPTY: PersistedWorkspaceState = {
  selectedDomainIds: [],
  domainPositions: {},
  externalPositions: {},
  collapsedModules: {},
}

export function uniqueDomainIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

export function selectionForActiveDomain(
  selectedDomainIds: string[],
  previousActiveDomainId: string,
  nextActiveDomainId: string,
): string[] {
  const selected = uniqueDomainIds(selectedDomainIds)
  if (previousActiveDomainId && !selected.includes(previousActiveDomainId)) {
    selected.unshift(previousActiveDomainId)
  }
  if (selected.length <= 1) return [nextActiveDomainId]
  if (!selected.includes(nextActiveDomainId)) selected.push(nextActiveDomainId)
  return selected
}

function load(): PersistedWorkspaceState {
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as Partial<PersistedWorkspaceState> | null
    if (!value) return EMPTY
    return {
      selectedDomainIds: uniqueDomainIds(value.selectedDomainIds ?? []),
      domainPositions: value.domainPositions ?? {},
      externalPositions: value.externalPositions ?? {},
      collapsedModules: value.collapsedModules ?? {},
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
    domainPositions: state.domainPositions,
    externalPositions: state.externalPositions,
    collapsedModules: state.collapsedModules,
  }
}

const initial = load()

export const useSchemaWorkspace = create<WorkspaceCanvasState>((set) => ({
  ...initial,
  replaceDomains: (ids) =>
    set((state) => {
      const selectedDomainIds = uniqueDomainIds(ids)
      const next = { ...persisted(state), selectedDomainIds }
      persist(next)
      return { selectedDomainIds }
    }),
  toggleDomain: (id, primaryDomainId) =>
    set((state) => {
      const selected = new Set(state.selectedDomainIds)
      if (selected.has(id) && id !== primaryDomainId) selected.delete(id)
      else selected.add(id)
      selected.add(primaryDomainId)
      const selectedDomainIds = [...selected]
      persist({ ...persisted(state), selectedDomainIds })
      return { selectedDomainIds }
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
}))
