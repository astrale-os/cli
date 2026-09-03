import type {
  AnchorRef,
  WorkspacePanelUiState,
  WorkspaceSection,
  WorkspaceUiState,
} from '@shared/types'

import { create } from 'zustand'

import { detailRefFor } from './targets'

/** A targeting draft: what was clicked + where on screen to anchor the composer.
 *  `mode` decides which composer opens — a persistent comment or an ephemeral ask. */
export interface CommentDraft {
  mode: 'comment' | 'ask'
  /** Owning domain of the target. A draft without one is never created. */
  domainId: string
  /** Exact surface clicked in targeting mode. Kept transiently so the composer can
   *  leave that surface highlighted until it closes. */
  targetElement: HTMLElement
  anchor: AnchorRef
  excerpt: string
  x: number
  y: number
}

/** The main views of a domain. Talking to the agent and reading comments are NOT
 *  sections — they follow you across every view, from the work panel. */
export type SectionKey = WorkspaceSection

const SECTION_KEYS: readonly SectionKey[] = ['schema', 'core', 'tests', 'process']

/** Appearance: an explicit choice, or whatever the OS asks for. */
export type Theme = 'system' | 'light' | 'dark'

/** How every canvas draws a relationship: a curve between the cards, or right-angled traces. */
export type EdgeStyle = WorkspaceUiState['edgeStyle']

/** Which half of the work panel is showing. */
export type PanelTab = WorkspacePanelUiState['tab']
/** Where the work panel lives. `left` and `right` dock a column beside the view;
 *  `bottom` spends a single composer-shaped bar on it and floats the conversation
 *  over the middle of the screen when you click in. */
export type PanelSide = WorkspacePanelUiState['side']

function loadStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T | null
    if (value && allowed.includes(value)) return value
  } catch {}
  return fallback
}

function storeBrowserPreference(key: string, value: string): void {
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
  section: SectionKey
  /** Local scope shared by Core/Tests/Process. It never scopes the agent or comments. */
  readerDomainId?: string
  /** appearance preference, persisted in this browser */
  theme: Theme
  /** the theme actually painted — `system` resolved. Canvas colours that land in
   *  SVG attributes need a real value, not a CSS function. */
  resolvedTheme: 'light' | 'dark'
  /** edge drawing preference, persisted in this workspace's machine-side UI state */
  edgeStyle: EdgeStyle
  /** work panel: the agent conversation and the comment threads, docked beside the view.
   *  Docked bottom there is no column to expand — this is then the floating chat itself. */
  panelOpen: boolean
  panelTab: PanelTab
  panelSide: PanelSide
  /** panel width in px when docked left/right; the bottom dock has no size to keep */
  panelSize: number
  /** domains/modules rail furniture, scoped to this scanned workspace */
  modulesWidth: number
  modulesCollapsed: boolean
  /** What is typed in the agent composer. It lives here, not in the composer, so that
   *  closing the floating chat — or re-docking the panel — never throws a message away. */
  agentDraft: string
  selectedClass?: string
  /**
   * Which domain `selectedClass` and `focusId` belong to. A class ref is LOCAL
   * (`class.Order`), and on a workspace canvas the same name exists in several frames —
   * so the selection carries its owner. There is no active-domain fallback.
   */
  selectionDomainId?: string
  /** graph focus: which node is pinned (dims non-neighbors). null = no focus. */
  focusId: string | null
  /** when set, the RIGHT PANEL shows a domain-level overlay (Views / Domains / Integrations
   *  overview) instead of the selected-class detail. Cleared by selecting a class / navigating. */
  panelOverlay: {
    kind: 'views' | 'domains' | 'integrations'
    /** Domains and Integrations are local; Views may span the whole canvas. */
    domainId?: string
  } | null
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
  /** A policy another section asked Tests to open on its demo data; Tests takes it and clears it. */
  probePolicy: string | null
  setTheme: (theme: Theme) => void
  setEdgeStyle: (style: EdgeStyle) => void
  /** Go to Tests with this policy selected — the way Process and the detail panel hand one over. */
  openPolicy: (policy: string, domainId?: string) => void
  setProbePolicy: (policy: string | null) => void
  setSection: (s: SectionKey) => void
  setReaderDomain: (domainId?: string) => void
  setPanelOpen: (open: boolean) => void
  setPanelTab: (tab: PanelTab) => void
  setPanelSide: (side: PanelSide) => void
  setPanelSize: (size: number) => void
  setModulesWidth: (width: number) => void
  setModulesCollapsed: (collapsed: boolean) => void
  setAgentDraft: (text: string) => void
  /** Jump to whatever an anchor points at: the right section, the member that declares
   *  it selected and focused, and the anchor itself recorded in `revealedRef`. */
  revealAnchor: (ref: string, domainId: string) => void
  setPanelOverlay: (kind: 'views' | 'domains' | 'integrations' | null, domainId?: string) => void
  /** `domainId` names the owner; it is required for a real selection. */
  selectClass: (n?: string, domainId?: string) => void
  /** select a class AND pin graph focus to it (toggles focus if same id) */
  focusClass: (id: string, domainId: string) => void
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
export const useUI = create<UIState>((set) => ({
  section: 'schema',
  theme: initialTheme,
  resolvedTheme: paintTheme(initialTheme),
  edgeStyle: 'curved',
  // The bottom dock always starts closed: there, `panelOpen` is a modal over the
  // domain, and reopening one on load would hide the thing you came back to see.
  panelOpen: false,
  panelTab: 'agent',
  panelSide: 'bottom',
  panelSize: 360,
  modulesWidth: 240,
  modulesCollapsed: false,
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
  probePolicy: null,
  openPolicy: (probePolicy, readerDomainId) => {
    set({
      section: 'tests',
      probePolicy,
      ...(readerDomainId ? { readerDomainId } : {}),
      panelOverlay: null,
      revealedRef: null,
      revealTarget: null,
      openAnchorRef: null,
    })
  },
  setProbePolicy: (probePolicy) => set({ probePolicy }),
  setTheme: (theme) => {
    storeBrowserPreference('studio.theme', theme)
    set({ theme, resolvedTheme: paintTheme(theme) })
  },
  setEdgeStyle: (edgeStyle) => set({ edgeStyle }),
  setSection: (section) => {
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
  setReaderDomain: (readerDomainId) => set({ readerDomainId }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setPanelTab: (panelTab) => set({ panelTab, panelOpen: true }),
  setPanelSide: (panelSide) => {
    // Re-docking lands on that side's resting state: a column beside the view for
    // left/right, the bar alone for bottom — nobody moves a panel to then dismiss
    // a modal sitting where they moved it from.
    const panelOpen = panelSide !== 'bottom'
    set({ panelSide, panelOpen })
  },
  setPanelSize: (panelSize) => set({ panelSize }),
  setModulesWidth: (modulesWidth) => set({ modulesWidth }),
  setModulesCollapsed: (modulesCollapsed) => set({ modulesCollapsed }),
  setAgentDraft: (agentDraft) => set({ agentDraft }),
  revealAnchor: (ref, domainId) => {
    const section: SectionKey = ref.startsWith('section.')
      ? ((ref.slice('section.'.length).split('.')[0] as SectionKey) ?? 'schema')
      : ref.startsWith('core.')
        ? 'core'
        : 'schema'
    const target = SECTION_KEYS.includes(section) ? section : 'schema'
    // A property or method is revealed INSIDE the member that declares it — selecting
    // the field itself would select a canvas node that does not exist.
    const selection = detailRefFor(ref)
    set(() => ({
      section: target,
      panelOverlay: null,
      revealedRef: ref,
      selectionDomainId: domainId,
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
  setPanelOverlay: (kind, domainId) =>
    set({ panelOverlay: kind ? { kind, ...(domainId ? { domainId } : {}) } : null }),
  selectClass: (selectedClass, domainId) =>
    set((s) => {
      const owner = selectedClass === undefined ? undefined : domainId
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
      const owner = domainId
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
}))

/** The small persistent projection of the UI store; transient selections stay in memory. */
export function uiWorkspaceSnapshot(state = useUI.getState()): Pick<
  WorkspaceUiState,
  'section' | 'edgeStyle' | 'panel' | 'rail'
> & {
  readerDomainId: string | null
} {
  return {
    section: state.section,
    edgeStyle: state.edgeStyle,
    readerDomainId: state.readerDomainId ?? null,
    panel: {
      open: state.panelOpen,
      tab: state.panelTab,
      side: state.panelSide,
      size: Math.min(900, Math.max(260, Math.round(state.panelSize))),
    },
    rail: {
      width: Math.min(560, Math.max(180, Math.round(state.modulesWidth))),
      collapsed: state.modulesCollapsed,
    },
  }
}

/** Install the server-owned workspace state without disturbing transient interaction state. */
export function hydrateWorkspaceUi(state: WorkspaceUiState): void {
  useUI.setState({
    section: state.section,
    edgeStyle: state.edgeStyle,
    readerDomainId: state.readerDomainId,
    panelOpen: state.panel.side === 'bottom' ? false : state.panel.open,
    panelTab: state.panel.tab,
    panelSide: state.panel.side,
    panelSize: state.panel.size,
    modulesWidth: state.rail.width,
    modulesCollapsed: state.rail.collapsed,
  })
}

// Following the OS means following it live, not only at boot.
globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useUI.getState().theme === 'system') useUI.setState({ resolvedTheme: paintTheme('system') })
})
