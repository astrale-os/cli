import type { AnchorRef } from '@shared/types'

import { create } from 'zustand'

/** A targeting draft: what was clicked + where on screen to anchor the composer.
 *  `mode` decides which composer opens — a persistent comment or an ephemeral ask. */
export interface CommentDraft {
  mode: 'comment' | 'ask'
  anchor: AnchorRef
  excerpt: string
  x: number
  y: number
}

export type SectionKey = 'context' | 'schema' | 'process' | 'comments'

/** Restore the last dock section across refreshes; first-ever visit lands on Context. */
function loadSection(): SectionKey {
  try {
    const v = localStorage.getItem('studio.lastSection')
    if (v === 'context' || v === 'schema' || v === 'process' || v === 'comments') return v
  } catch {}
  return 'context'
}

interface UIState {
  domainId?: string
  section: SectionKey
  selectedClass?: string
  /** navigation history of prior `selectedClass` values (powers the detail-pane Back button) */
  selectionHistory: string[]
  /** graph focus: which node is pinned (dims non-neighbors). null = no focus. */
  focusId: string | null
  /** schema graph vs the core (genesis) data view — toggled from the Domains panel */
  canvasMode: 'schema' | 'core'
  /** when set, the RIGHT PANEL shows a domain-level overlay (Views / Domains / Integrations
   *  overview) instead of the selected-class detail. Cleared by selecting a class / navigating. */
  panelOverlay: 'views' | 'domains' | 'integrations' | null
  /** file-module paths the user has collapsed (hidden in tree + canvas) */
  collapsedModules: string[]
  /** comment-mode draft: the floating composer target + screen position */
  commentDraft: CommentDraft | null
  /** Per-element canvas hide-set keyed by ref: `class.X` | `edge.X` | `domain.<origin>`.
   *  Interfaces do NOT use this set — their sole control is `materializedInterfaces` below.
   *  Everything is shown by default, so membership ⇒ hidden (no tri-state). Persisted per domain. */
  hidden: Record<string, true>
  /** Category control for the dashed interface-induced (poly) edge fan-out. Persisted per domain. */
  showInheritedEdges: boolean
  /** Local interfaces shown as canvas NODES instead of badges, keyed by bare interface name.
   *  The interface's sole per-element control (it never joins `hidden`). Persisted per domain. */
  materializedInterfaces: Record<string, true>
  /** which anchor's comment thread-popover is currently open (one at a time) */
  openAnchorRef: string | null
  /** which pin INSTANCE opened it (a `useId()`), so when the same ref is pinned in
   *  two places (e.g. a class on the canvas AND in the detail pane) only the clicked
   *  one's popover renders — not both. null ⇒ opened programmatically (unique ref). */
  openAnchorId: string | null
  /** global "comment on anything" mode (hotkey C) */
  commentMode: boolean
  /** global "ask a side-question on anything" mode (hotkey A) — sibling of commentMode */
  askMode: boolean
  /** command palette (Cmd+K) open */
  paletteOpen: boolean
  /** hidden power-user Settings dialog open */
  settingsOpen: boolean
  copyOpen: boolean
  mergeOpen: boolean
  setDomain: (id?: string) => void
  setSection: (s: SectionKey) => void
  /** switch the schema canvas between the schema graph and the core (genesis) view */
  setCanvasMode: (m: 'schema' | 'core') => void
  setPanelOverlay: (v: 'views' | 'domains' | 'integrations' | null) => void
  selectClass: (n?: string) => void
  /** restore the previous selection from selectionHistory (detail-pane Back) */
  back: () => void
  /** select a class AND pin graph focus to it (toggles focus if same id) */
  focusClass: (id: string) => void
  setFocus: (id: string | null) => void
  toggleModule: (path: string) => void
  toggleHidden: (ref: string) => void
  /** Toggle a local interface between badge (default) and materialized canvas node. */
  toggleInterfaceMaterialized: (name: string) => void
  /** Replace the whole visibility slice (used to hydrate from the persisted per-domain state). */
  setVisibility: (v: {
    hidden: Record<string, true>
    showInheritedEdges: boolean
    materializedInterfaces: Record<string, true>
  }) => void
  toggleInheritedEdges: () => void
  setOpenAnchor: (ref: string | null, id?: string | null) => void
  toggleCommentMode: (on?: boolean) => void
  toggleAskMode: (on?: boolean) => void
  setCommentDraft: (d: CommentDraft | null) => void
  setPaletteOpen: (b: boolean) => void
  setSettingsOpen: (b: boolean) => void
  setCopyOpen: (b: boolean) => void
  setMergeOpen: (b: boolean) => void
}

export const useUI = create<UIState>((set) => ({
  section: loadSection(),
  focusId: null,
  canvasMode: 'schema',
  panelOverlay: null,
  selectionHistory: [],
  collapsedModules: [],
  commentDraft: null,
  hidden: {},
  showInheritedEdges: true,
  materializedInterfaces: {},
  openAnchorRef: null,
  openAnchorId: null,
  commentMode: false,
  askMode: false,
  paletteOpen: false,
  settingsOpen: false,
  copyOpen: false,
  mergeOpen: false,
  setDomain: (domainId) => {
    try {
      if (domainId) localStorage.setItem('studio.lastDomain', domainId)
    } catch {}
    set({
      domainId,
      canvasMode: 'schema',
      panelOverlay: null,
      selectedClass: undefined,
      focusId: null,
      openAnchorRef: null,
      selectionHistory: [],
      // Visibility is PER-DOMAIN — clear it on switch so the previous domain's hide/
      // materialize set never bleeds into the new one. The graph then hydrates this
      // domain's persisted slice. (Without this reset a surviving materialized
      // interface drove an infinite reconcile loop → React #185 blank screen.)
      hidden: {},
      showInheritedEdges: true,
      materializedInterfaces: {},
    })
  },
  setSection: (section) => {
    try {
      localStorage.setItem('studio.lastSection', section)
    } catch {}
    set({ section, canvasMode: 'schema', panelOverlay: null, openAnchorRef: null })
  },
  setCanvasMode: (canvasMode) =>
    set({
      canvasMode,
      panelOverlay: null,
      selectedClass: undefined,
      focusId: null,
      openAnchorRef: null,
      selectionHistory: [],
    }),
  setPanelOverlay: (panelOverlay) => set({ panelOverlay }),
  selectClass: (selectedClass) =>
    set((s) => {
      if (selectedClass === s.selectedClass && !s.panelOverlay) return {}
      return {
        selectedClass,
        panelOverlay: null,
        focusId: selectedClass?.startsWith('class.') ? selectedClass : s.focusId,
        selectionHistory: s.selectedClass
          ? [...s.selectionHistory, s.selectedClass].slice(-50)
          : s.selectionHistory,
      }
    }),
  focusClass: (id) =>
    set((s) => ({
      selectedClass: id,
      panelOverlay: null,
      focusId: s.focusId === id ? null : id,
      selectionHistory:
        s.selectedClass && s.selectedClass !== id
          ? [...s.selectionHistory, s.selectedClass].slice(-50)
          : s.selectionHistory,
    })),
  setFocus: (focusId) => set({ focusId }),
  back: () =>
    set((s) => {
      if (!s.selectionHistory.length) return {}
      const prev = s.selectionHistory[s.selectionHistory.length - 1]
      return {
        selectedClass: prev,
        panelOverlay: null,
        focusId: prev.startsWith('class.') ? prev : s.focusId,
        selectionHistory: s.selectionHistory.slice(0, -1),
      }
    }),
  toggleModule: (path) =>
    set((s) => ({
      collapsedModules: s.collapsedModules.includes(path)
        ? s.collapsedModules.filter((p) => p !== path)
        : [...s.collapsedModules, path],
    })),
  toggleHidden: (ref) =>
    set((s) => {
      const next = { ...s.hidden }
      if (next[ref]) delete next[ref]
      else next[ref] = true
      return { hidden: next }
    }),
  toggleInterfaceMaterialized: (name) =>
    set((s) => {
      const next = { ...s.materializedInterfaces }
      if (next[name]) delete next[name]
      else next[name] = true
      return { materializedInterfaces: next }
    }),
  setVisibility: ({ hidden, showInheritedEdges, materializedInterfaces }) =>
    set({ hidden, showInheritedEdges, materializedInterfaces }),
  toggleInheritedEdges: () => set((s) => ({ showInheritedEdges: !s.showInheritedEdges })),
  setOpenAnchor: (openAnchorRef, openAnchorId = null) => set({ openAnchorRef, openAnchorId }),
  toggleCommentMode: (on) =>
    set((s) => ({ commentMode: on ?? !s.commentMode, askMode: false, openAnchorRef: null })),
  toggleAskMode: (on) =>
    set((s) => ({ askMode: on ?? !s.askMode, commentMode: false, openAnchorRef: null })),
  setCommentDraft: (commentDraft) => set({ commentDraft }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setCopyOpen: (copyOpen) => set({ copyOpen }),
  setMergeOpen: (mergeOpen) => set({ mergeOpen }),
}))
