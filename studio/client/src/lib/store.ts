import type { AnchorRef } from '@shared/types'

import { create } from 'zustand'

/** A targeting draft: what was clicked + where on screen to anchor the composer.
 *  `mode` decides which composer opens — a persistent comment or an ephemeral ask. */
export interface CommentDraft {
  mode: 'comment' | 'ask'
  /** Owning domain of the target; omitted for domain-level surfaces. */
  domainId?: string
  anchor: AnchorRef
  excerpt: string
  x: number
  y: number
}

/** The main views of a domain. Talking to the agent and reading comments are NOT
 *  sections — they follow you across every view, from the work panel. */
export type SectionKey = 'schema' | 'process'

const SECTION_KEYS: readonly SectionKey[] = ['schema', 'process']

/** Appearance: an explicit choice, or whatever the OS asks for. */
export type Theme = 'system' | 'light' | 'dark'

/** Which half of the work panel is showing. */
export type PanelTab = 'agent' | 'comments'
/** Where the work panel is docked. */
export type PanelSide = 'left' | 'right' | 'bottom'

function loadStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T | null
    if (value && allowed.includes(value)) return value
  } catch {}
  return fallback
}

function loadNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const value = Number(localStorage.getItem(key))
    if (Number.isFinite(value) && value >= min && value <= max) return value
  } catch {}
  return fallback
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

/** Paint the theme on <html> and report what is actually showing. */
function paintTheme(theme: Theme): 'light' | 'dark' {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true)
  globalThis.document?.documentElement.classList.toggle('dark', dark)
  return dark ? 'dark' : 'light'
}

interface UIState {
  domainId?: string
  section: SectionKey
  /** appearance preference, persisted in this browser */
  theme: Theme
  /** the theme actually painted — `system` resolved. Canvas colours that land in
   *  SVG attributes need a real value, not a CSS function. */
  resolvedTheme: 'light' | 'dark'
  /** work panel: the agent conversation and the comment threads, docked beside the view */
  panelOpen: boolean
  panelTab: PanelTab
  panelSide: PanelSide
  /** panel thickness in px — width when docked left/right, height when docked bottom */
  panelSize: number
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
   *  Everything is shown by default, so membership ⇒ hidden (no tri-state). Persisted per domain. */
  hidden: Record<string, true>
  /** Category control for Class inheritance edges. Persisted per domain. */
  showInheritedEdges: boolean
  /** Canvas reading mode: direction only (default) or the declared multiplicities. */
  showCardinality: boolean
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
  setTheme: (theme: Theme) => void
  setDomain: (id?: string) => void
  setSection: (s: SectionKey) => void
  setPanelOpen: (open: boolean) => void
  setPanelTab: (tab: PanelTab) => void
  setPanelSide: (side: PanelSide) => void
  setPanelSize: (size: number) => void
  /** Jump to whatever an anchor points at: the right section, class selected and focused. */
  revealAnchor: (ref: string) => void
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
  /** Replace the whole visibility slice (used to hydrate from the persisted per-domain state). */
  setVisibility: (v: { hidden: Record<string, true>; showInheritedEdges: boolean }) => void
  toggleInheritedEdges: () => void
  toggleCardinality: () => void
  setOpenAnchor: (ref: string | null, id?: string | null) => void
  toggleCommentMode: (on?: boolean) => void
  toggleAskMode: (on?: boolean) => void
  setCommentDraft: (d: CommentDraft | null) => void
  setPaletteOpen: (b: boolean) => void
  setSettingsOpen: (b: boolean) => void
}

/** `edge.X` selects like a class (both live in the `class.` selection namespace). */
function revealSelection(ref: string): string {
  if (ref.startsWith('edge.')) return `class.${ref.slice('edge.'.length)}`
  return ref
}
function revealFocus(ref: string): string | null {
  const selection = revealSelection(ref)
  return selection.startsWith('class.') ? selection : null
}

const initialTheme = loadStored('studio.theme', ['system', 'light', 'dark'] as const, 'system')

export const useUI = create<UIState>((set) => ({
  section: loadStored('studio.lastSection', SECTION_KEYS, 'schema'),
  theme: initialTheme,
  resolvedTheme: paintTheme(initialTheme),
  panelOpen: loadStored('studio.panelOpen', ['yes', 'no'] as const, 'yes') === 'yes',
  panelTab: loadStored('studio.panelTab', ['agent', 'comments'] as const, 'agent'),
  panelSide: loadStored('studio.panelSide', ['left', 'right', 'bottom'] as const, 'left'),
  panelSize: loadNumber('studio.panelSize', 360, 260, 900),
  focusId: null,
  canvasMode: 'schema',
  panelOverlay: null,
  selectionHistory: [],
  collapsedModules: [],
  commentDraft: null,
  hidden: {},
  showInheritedEdges: true,
  showCardinality: false,
  openAnchorRef: null,
  openAnchorId: null,
  commentMode: false,
  askMode: false,
  paletteOpen: false,
  settingsOpen: false,
  setTheme: (theme) => {
    store('studio.theme', theme)
    set({ theme, resolvedTheme: paintTheme(theme) })
  },
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
      // Visibility is PER-DOMAIN — clear it on switch so the previous domain's hide
      // set never bleeds into the new one. The graph then hydrates this domain's slice.
      hidden: {},
      showInheritedEdges: true,
    })
  },
  setSection: (section) => {
    store('studio.lastSection', section)
    set({ section, canvasMode: 'schema', panelOverlay: null, openAnchorRef: null })
  },
  setPanelOpen: (panelOpen) => {
    store('studio.panelOpen', panelOpen ? 'yes' : 'no')
    set({ panelOpen })
  },
  setPanelTab: (panelTab) => {
    store('studio.panelTab', panelTab)
    set({ panelTab, panelOpen: true })
  },
  setPanelSide: (panelSide) => {
    store('studio.panelSide', panelSide)
    set({ panelSide })
  },
  setPanelSize: (panelSize) => {
    store('studio.panelSize', String(Math.round(panelSize)))
    set({ panelSize })
  },
  revealAnchor: (ref) => {
    const section: SectionKey = ref.startsWith('section.')
      ? ((ref.slice('section.'.length).split('.')[0] as SectionKey) ?? 'schema')
      : 'schema'
    const target = SECTION_KEYS.includes(section) ? section : 'schema'
    store('studio.lastSection', target)
    set((state) => ({
      section: target,
      canvasMode: 'schema',
      panelOverlay: null,
      ...(ref.startsWith('class.') || ref.startsWith('edge.') || ref.startsWith('module.')
        ? { selectedClass: revealSelection(ref), focusId: revealFocus(ref) }
        : {}),
      selectionHistory: state.selectedClass
        ? [...state.selectionHistory, state.selectedClass].slice(-50)
        : state.selectionHistory,
    }))
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
  setVisibility: ({ hidden, showInheritedEdges }) => set({ hidden, showInheritedEdges }),
  toggleInheritedEdges: () => set((s) => ({ showInheritedEdges: !s.showInheritedEdges })),
  toggleCardinality: () => set((s) => ({ showCardinality: !s.showCardinality })),
  setOpenAnchor: (openAnchorRef, openAnchorId = null) => set({ openAnchorRef, openAnchorId }),
  toggleCommentMode: (on) =>
    set((s) => ({ commentMode: on ?? !s.commentMode, askMode: false, openAnchorRef: null })),
  toggleAskMode: (on) =>
    set((s) => ({ askMode: on ?? !s.askMode, commentMode: false, openAnchorRef: null })),
  setCommentDraft: (commentDraft) => set({ commentDraft }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}))

// Following the OS means following it live, not only at boot.
globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useUI.getState().theme === 'system') useUI.setState({ resolvedTheme: paintTheme('system') })
})
