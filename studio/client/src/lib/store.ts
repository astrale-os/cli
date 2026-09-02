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
export type SectionKey = 'schema' | 'core' | 'tests' | 'process'

const SECTION_KEYS: readonly SectionKey[] = ['schema', 'core', 'tests', 'process']

/** Appearance: an explicit choice, or whatever the OS asks for. */
export type Theme = 'system' | 'light' | 'dark'

/** How every canvas draws a relationship: a curve between the cards, or right-angled traces. */
export type EdgeStyle = 'curved' | 'orthogonal'

/** Which half of the work panel is showing. */
export type PanelTab = 'agent' | 'comments'
/** Where the work panel lives. `left` and `right` dock a column beside the view;
 *  `bottom` spends a single composer-shaped bar on it and floats the conversation
 *  over the middle of the screen when you click in. */
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
  /** edge drawing preference, persisted in this browser; curves unless asked otherwise */
  edgeStyle: EdgeStyle
  /** work panel: the agent conversation and the comment threads, docked beside the view.
   *  Docked bottom there is no column to expand — this is then the floating chat itself. */
  panelOpen: boolean
  panelTab: PanelTab
  panelSide: PanelSide
  /** panel width in px when docked left/right; the bottom dock has no size to keep */
  panelSize: number
  /** What is typed in the agent composer. It lives here, not in the composer, so that
   *  closing the floating chat — or re-docking the panel — never throws a message away. */
  agentDraft: string
  selectedClass?: string
  /**
   * Which domain `selectedClass` and `focusId` belong to. A class ref is LOCAL
   * (`class.Order`), and on a workspace canvas the same name exists in several frames —
   * so the selection carries its owner instead of borrowing the active domain's. Selecting
   * in a domain no longer makes it active: the canvas draws every domain it holds at equal
   * standing, and `domainId` answers a different question (see the store's doc on it).
   */
  selectionDomainId?: string
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
  /** The new-domain composer, centred over everything: a name, a first message,
   *  and the domain that does not exist yet between them. */
  newDomainOpen: boolean
  /** A domain the reader asked to work in, waiting on the confirmation that says what
   *  changes. Null when nothing is pending. */
  domainSwitchRequest: { id: string; origin: string } | null
  /** Ask before switching. Turned off from the confirmation itself, remembered here. */
  confirmDomainSwitch: boolean
  /** A policy another section asked Tests to open on its demo data; Tests takes it and clears it. */
  probePolicy: string | null
  setTheme: (theme: Theme) => void
  setEdgeStyle: (style: EdgeStyle) => void
  /** Go to Tests with this policy selected — the way Process and the detail panel hand one over. */
  openPolicy: (policy: string) => void
  setProbePolicy: (policy: string | null) => void
  setDomain: (id?: string) => void
  setSection: (s: SectionKey) => void
  setPanelOpen: (open: boolean) => void
  setPanelTab: (tab: PanelTab) => void
  setPanelSide: (side: PanelSide) => void
  setPanelSize: (size: number) => void
  setAgentDraft: (text: string) => void
  /** Jump to whatever an anchor points at: the right section, the member that declares
   *  it selected and focused, and the anchor itself recorded in `revealedRef`. */
  revealAnchor: (ref: string) => void
  setPanelOverlay: (v: 'views' | 'domains' | 'integrations' | null) => void
  /** `domainId` names the owner; omitted, the selection belongs to the active domain. */
  selectClass: (n?: string, domainId?: string) => void
  /** select a class AND pin graph focus to it (toggles focus if same id) */
  focusClass: (id: string, domainId?: string) => void
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
  setNewDomainOpen: (b: boolean) => void
  requestDomainSwitch: (request: { id: string; origin: string } | null) => void
  setConfirmDomainSwitch: (on: boolean) => void
}

/** `edge.X` selects like a class (both live in the `class.` selection namespace). */
function revealSelection(ref: string): string {
  if (ref.startsWith('edge.')) return `class.${ref.slice('edge.'.length)}`
  return ref
}
/** A relationship is drawn as a LINE, so there is no node for focus to pin — and pinning it
 *  on the edge's own name would fade the canvas against a node that is not on it. */
function revealFocus(ref: string): string | null {
  if (ref.startsWith('edge.')) return null
  const selection = revealSelection(ref)
  return selection.startsWith('class.') ? selection : null
}
/** What the canvas is asked to bring into view. An `edge.` ref stays an edge ref: the canvas
 *  frames the cards its paths run between, and knows to drop the request if it draws none. */
function revealPan(ref: string): string | null {
  return ref.startsWith('edge.') ? ref : revealFocus(ref)
}

const initialTheme = loadStored('studio.theme', ['system', 'light', 'dark'] as const, 'system')
// The floating dock is where the panel starts: it costs the view nothing, and a
// first look at a domain should be the domain, not a column beside it.
const initialSide = loadStored('studio.panelSide', ['left', 'right', 'bottom'] as const, 'bottom')

export const useUI = create<UIState>((set) => ({
  section: loadStored('studio.lastSection', SECTION_KEYS, 'schema'),
  theme: initialTheme,
  resolvedTheme: paintTheme(initialTheme),
  edgeStyle: loadStored('studio.edgeStyle', ['curved', 'orthogonal'] as const, 'curved'),
  // The bottom dock always starts closed: there, `panelOpen` is a modal over the
  // domain, and reopening one on load would hide the thing you came back to see.
  panelOpen:
    initialSide !== 'bottom' &&
    loadStored('studio.panelOpen', ['yes', 'no'] as const, 'yes') === 'yes',
  panelTab: loadStored('studio.panelTab', ['agent', 'comments'] as const, 'agent'),
  panelSide: initialSide,
  panelSize: loadNumber('studio.panelSize', 360, 260, 900),
  agentDraft: '',
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
  newDomainOpen: false,
  domainSwitchRequest: null,
  confirmDomainSwitch:
    loadStored('studio.confirmDomainSwitch', ['yes', 'no'] as const, 'yes') === 'yes',
  probePolicy: null,
  openPolicy: (probePolicy) => {
    store('studio.lastSection', 'tests')
    set({
      section: 'tests',
      probePolicy,
      panelOverlay: null,
      revealedRef: null,
      revealTarget: null,
      openAnchorRef: null,
    })
  },
  setProbePolicy: (probePolicy) => set({ probePolicy }),
  setTheme: (theme) => {
    store('studio.theme', theme)
    set({ theme, resolvedTheme: paintTheme(theme) })
  },
  setEdgeStyle: (edgeStyle) => {
    store('studio.edgeStyle', edgeStyle)
    set({ edgeStyle })
  },
  setDomain: (domainId) => {
    try {
      if (domainId) localStorage.setItem('studio.lastDomain', domainId)
    } catch {}
    // The SELECTION is deliberately left alone: it carries its own domain now, and the
    // canvas draws every domain it holds whether or not one of them is active. Only the
    // things that are genuinely about the active domain are dropped — the domain-level
    // overlays, and whatever a reveal was pointing at.
    set({
      domainId,
      panelOverlay: null,
      revealedRef: null,
      revealTarget: null,
      openAnchorRef: null,
      domainSwitchRequest: null,
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
        ? { selectedClass: undefined, selectionDomainId: undefined, focusId: null }
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
    // Re-docking lands on that side's resting state: a column beside the view for
    // left/right, the bar alone for bottom — nobody moves a panel to then dismiss
    // a modal sitting where they moved it from.
    const panelOpen = panelSide !== 'bottom'
    store('studio.panelOpen', panelOpen ? 'yes' : 'no')
    set({ panelSide, panelOpen })
  },
  setPanelSize: (panelSize) => {
    store('studio.panelSize', String(Math.round(panelSize)))
    set({ panelSize })
  },
  setAgentDraft: (agentDraft) => set({ agentDraft }),
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
    set((s) => ({
      section: target,
      panelOverlay: null,
      revealedRef: ref,
      // revealed from the comments tab, which is the ACTIVE domain's
      selectionDomainId: s.domainId,
      ...(selection.startsWith('class.') ||
      selection.startsWith('edge.') ||
      selection.startsWith('module.')
        ? {
            selectedClass: revealSelection(selection),
            focusId: revealFocus(selection),
            revealTarget: revealPan(selection),
          }
        : // A DOMAIN is framed, not selected: the canvas brings its frame into view, and
          // the detail panel has nothing to open for one — it reads schema members.
          selection.startsWith('domain.')
          ? { revealTarget: selection }
          : {}),
    }))
  },
  setPanelOverlay: (panelOverlay) => set({ panelOverlay }),
  selectClass: (selectedClass, domainId) =>
    set((s) => {
      const owner = selectedClass === undefined ? undefined : (domainId ?? s.domainId)
      if (
        selectedClass === s.selectedClass &&
        owner === s.selectionDomainId &&
        !s.panelOverlay &&
        !s.revealedRef
      ) {
        return {}
      }
      return {
        selectedClass,
        selectionDomainId: owner,
        panelOverlay: null,
        revealedRef: null,
        revealTarget: null,
        // A same-named class in ANOTHER domain is a different node: focus follows the
        // selection there rather than staying pinned on the one it used to mean.
        focusId: selectedClass?.startsWith('class.')
          ? selectedClass
          : owner === s.selectionDomainId
            ? s.focusId
            : null,
      }
    }),
  focusClass: (id, domainId) =>
    set((s) => {
      const owner = domainId ?? s.domainId
      const same = s.focusId === id && s.selectionDomainId === owner
      return {
        selectedClass: id,
        selectionDomainId: owner,
        panelOverlay: null,
        revealedRef: null,
        revealTarget: null,
        focusId: same ? null : id,
      }
    }),
  clearSelection: () =>
    set((s) =>
      s.selectedClass === undefined &&
      s.focusId === null &&
      s.revealedRef === null &&
      s.revealTarget === null
        ? {}
        : {
            selectedClass: undefined,
            selectionDomainId: undefined,
            focusId: null,
            revealedRef: null,
            revealTarget: null,
          },
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
  setNewDomainOpen: (newDomainOpen) => set({ newDomainOpen }),
  requestDomainSwitch: (domainSwitchRequest) => set({ domainSwitchRequest }),
  setConfirmDomainSwitch: (confirmDomainSwitch) => {
    store('studio.confirmDomainSwitch', confirmDomainSwitch ? 'yes' : 'no')
    set({ confirmDomainSwitch })
  },
}))

// Following the OS means following it live, not only at boot.
globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useUI.getState().theme === 'system') useUI.setState({ resolvedTheme: paintTheme('system') })
})
