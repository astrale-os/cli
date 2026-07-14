import { create } from 'zustand'

export interface WorkspacePoint {
  x: number
  y: number
}

interface PersistedWorkspaceState {
  selectedDomainIds: string[]
  domainPositions: Record<string, WorkspacePoint>
  domainContentOffsets: Record<string, WorkspacePoint>
  collapsedModules: Record<string, string[]>
  badgeInterfaces: Record<string, string[]>
}

interface WorkspaceCanvasState extends PersistedWorkspaceState {
  replaceDomains: (ids: string[]) => void
  toggleDomain: (id: string, primaryDomainId: string) => void
  setDomainPosition: (id: string, position: WorkspacePoint) => void
  ensureDomainContentOffsets: (offsets: Record<string, WorkspacePoint>) => void
  resetDomainPositions: () => void
  toggleModule: (domainId: string, path: string) => void
  toggleInterface: (domainId: string, name: string) => void
}

const STORAGE_KEY = 'studio.schemaWorkspace.v1'

const EMPTY: PersistedWorkspaceState = {
  selectedDomainIds: [],
  domainPositions: {},
  domainContentOffsets: {},
  collapsedModules: {},
  badgeInterfaces: {},
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
      domainContentOffsets: value.domainContentOffsets ?? {},
      collapsedModules: value.collapsedModules ?? {},
      badgeInterfaces: value.badgeInterfaces ?? {},
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

function persisted(state: WorkspaceCanvasState): PersistedWorkspaceState {
  return {
    selectedDomainIds: state.selectedDomainIds,
    domainPositions: state.domainPositions,
    domainContentOffsets: state.domainContentOffsets,
    collapsedModules: state.collapsedModules,
    badgeInterfaces: state.badgeInterfaces,
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
      const domainPositions = { ...state.domainPositions, [id]: position }
      persist({ ...persisted(state), domainPositions })
      return { domainPositions }
    }),
  ensureDomainContentOffsets: (offsets) =>
    set((state) => {
      const domainContentOffsets = { ...state.domainContentOffsets }
      let changed = false
      for (const [domainId, offset] of Object.entries(offsets)) {
        if (domainContentOffsets[domainId]) continue
        domainContentOffsets[domainId] = offset
        changed = true
      }
      if (!changed) return state
      persist({ ...persisted(state), domainContentOffsets })
      return { domainContentOffsets }
    }),
  resetDomainPositions: () =>
    set((state) => {
      persist({ ...persisted(state), domainPositions: {} })
      return { domainPositions: {} }
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
  toggleInterface: (domainId, name) =>
    set((state) => {
      const current = new Set(state.badgeInterfaces[domainId] ?? [])
      if (current.has(name)) current.delete(name)
      else current.add(name)
      const badgeInterfaces = { ...state.badgeInterfaces, [domainId]: [...current] }
      persist({ ...persisted(state), badgeInterfaces })
      return { badgeInterfaces }
    }),
}))
