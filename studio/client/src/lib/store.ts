import type { AnchorRef } from '@shared/types'

import { create } from 'zustand'

import { detailRefFor } from './targets'

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
export type SectionKey = 'schema' | 'core' | 'process'

const SECTION_KEYS: readonly SectionKey[] = ['schema', 'core', 'process']

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
  /** graph focus: which node is pinned (dims non-neighbors). null = no focus. */
  focusId: string | null
  /** when set, the RIGHT PANEL shows a domain-level overlay (Views / Domains / Integrations
   *  overview) instead of the selected-class detail. Cleared by selecting a class / navigating. */
  panelOverlay: 'views' | 'domains' | 'integrations' | null
  /** comment-mode draft: the floating composer target + screen position */
  commentDraft: CommentDraft | null
  /** Canvas reading mode: direction only (default) or the declared multiplicities. */
  showCardinality: boolean
  /** The exact anchor a thread was just revealed from — kept alongside `selectedClass`
   *  because the two differ: a comment on `class.Order.property.total` opens Order, and
   *  this is what then singles the `total` row out inside it. Cleared by any other
   *  selection. */
  revealedRef: string | null
  /** A class an explicit JUMP asked the canvas to bring into view (⌘K, or revealing a
   *  comment's anchor). A plain click never sets it: selecting a node must leave the canvas
   *  exactly where the reader put it. The canvas clears it once it has framed the target. */
  revealTarget: string | null
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
  /** Jump to whatever an anchor points at: the right section, the member that declares
   *  it selected and focused, and the anchor itself recorded in `revealedRef`. */
  revealAnchor: (ref: string) => void
  setPanelOverlay: (v: 'views' | 'domains' | 'integrations' | null) => void
  selectClass: (n?: string) => void
  /** select a class AND pin graph focus to it (toggles focus if same id) */
  focusClass: (id: string) => void
  /** Drop the selection and its graph focus — what clicking empty space means. Leaves an
   *  open overlay panel (Views / Domains / Integrations) alone: it is not a selection. */
  clearSelection: () => void
  setFocus: (id: string | null) => void
  toggleCardinality: () => void
  setOpenAnchor: (ref: string | null, id?: string | null) => void
  /** ask the canvas to frame a class (the ⌘K path) — and, once framed, to forget it */
  revealOnCanvas: (ref: string | null) => void
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
  panelOverlay: null,
  commentDraft: null,
  revealedRef: null,
  revealTarget: null,
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
      panelOverlay: null,
      selectedClass: undefined,
      focusId: null,
      revealedRef: null,
      revealTarget: null,
      openAnchorRef: null,
    })
  },
  setSection: (section) => {
    store('studio.lastSection', section)
    // Schema and Core are two canvases over the same domain with DISJOINT selection
    // namespaces (`class.X` vs a core path), so crossing between them starts clean —
    // carrying a class selection into Core would open a detail panel for nothing.
    set((s) => ({
      section,
      panelOverlay: null,
      revealedRef: null,
      revealTarget: null,
      openAnchorRef: null,
      ...((s.section === 'core') !== (section === 'core')
        ? { selectedClass: undefined, focusId: null }
        : {}),
    }))
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
      : ref.startsWith('core.')
        ? 'core'
        : 'schema'
    const target = SECTION_KEYS.includes(section) ? section : 'schema'
    store('studio.lastSection', target)
    // A property or method is revealed INSIDE the member that declares it — selecting
    // the field itself would select a canvas node that does not exist.
    const selection = detailRefFor(ref)
    set({
      section: target,
      panelOverlay: null,
      revealedRef: ref,
      ...(selection.startsWith('class.') ||
      selection.startsWith('edge.') ||
      selection.startsWith('module.')
        ? {
            selectedClass: revealSelection(selection),
            focusId: revealFocus(selection),
            revealTarget: revealFocus(selection),
          }
        : {}),
    })
  },
  setPanelOverlay: (panelOverlay) => set({ panelOverlay }),
  selectClass: (selectedClass) =>
    set((s) => {
      if (selectedClass === s.selectedClass && !s.panelOverlay && !s.revealedRef) return {}
      return {
        selectedClass,
        panelOverlay: null,
        revealedRef: null,
        revealTarget: null,
        focusId: selectedClass?.startsWith('class.') ? selectedClass : s.focusId,
      }
    }),
  focusClass: (id) =>
    set((s) => ({
      selectedClass: id,
      panelOverlay: null,
      revealedRef: null,
      revealTarget: null,
      focusId: s.focusId === id ? null : id,
    })),
  clearSelection: () =>
    set((s) =>
      s.selectedClass === undefined &&
      s.focusId === null &&
      s.revealedRef === null &&
      s.revealTarget === null
        ? {}
        : { selectedClass: undefined, focusId: null, revealedRef: null, revealTarget: null },
    ),
  setFocus: (focusId) => set({ focusId }),
  toggleCardinality: () => set((s) => ({ showCardinality: !s.showCardinality })),
  setOpenAnchor: (openAnchorRef, openAnchorId = null) => set({ openAnchorRef, openAnchorId }),
  revealOnCanvas: (revealTarget) => set({ revealTarget }),
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
