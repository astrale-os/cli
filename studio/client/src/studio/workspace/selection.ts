/**
 * What the Workspace level remembers while the Studio is open: the selection on the map, whether
 * its panel is shown, whether every Domain is judged, and which Domain's Publish dialog is open.
 * It outlives leaving the level and coming back; it is never written anywhere but the address.
 */

import { create } from 'zustand'

interface WorkspaceView {
  /** the selected map id: `domain:<id>`, `origin:<origin>` or `dependency:<id>:<alias>` */
  selected?: string
  /** a map id to bring into view once */
  reveal: string | null
  panelOpen: boolean
  /** every Domain's change report and compatibility are read, whatever the Workspace's size */
  everything: boolean
  /** the Domain whose Publish dialog is open */
  publishing?: string
  /** a selection an address named, until the map is read and says whether it draws it */
  arrived?: string
  select: (id: string | undefined, reveal?: boolean) => void
  /** selects what an address names, to be checked against the map once it is read */
  arrive: (id: string | undefined) => void
  /** the map has been read: the selection an address named is checked */
  settleArrival: () => void
  revealed: () => void
  setPanelOpen: (open: boolean) => void
  judgeEverything: () => void
  openPublish: (domainId: string | undefined) => void
}

export const useWorkspaceView = create<WorkspaceView>((set) => ({
  reveal: null,
  panelOpen: true,
  everything: false,
  select: (selected, reveal = false) =>
    set({ selected, panelOpen: true, ...(reveal && selected ? { reveal: selected } : {}) }),
  arrive: (selected) => set({ selected, arrived: selected, panelOpen: true }),
  settleArrival: () => set({ arrived: undefined }),
  revealed: () => set({ reveal: null }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  judgeEverything: () => set({ everything: true }),
  openPublish: (publishing) => set({ publishing }),
}))
