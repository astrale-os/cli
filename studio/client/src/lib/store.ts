import type { WorkspacePanelUiState, WorkspaceUiState } from '@shared/contracts/workspace'

import { publicationOf } from '@shared/contracts/versions'
import { create } from 'zustand'

import { LENS_NAMES, type LensKey } from '@/studio/lenses/keys'

import { detailRefFor, type Target } from './targets'

/** A comment being written: the target clicked in comment mode, where it was made, and the
 *  click point the composer opens at. The target's element stays highlighted until it closes. */
export interface CommentDraft {
  target: Target
  x: number
  y: number
}

/** How far in the Studio reads: the whole Workspace, one Domain of it — its Schema — or one
 *  dataset of a Domain read through the lenses. Talking to the agent and reading comments are
 *  not levels: they follow you across every one, from the work panel. */
export type StudioLevel = 'workspace' | 'domain' | 'data'

/** The draft key for "no chat yet" — the chat list is a fetch, and the composer is
 *  on screen before it lands. No chat id can collide with it: chat ids are non-empty. */
const NO_CHAT = ''

/** Appearance: an explicit choice, or whatever the OS asks for. */
export type Theme = 'system' | 'light' | 'dark'
/** Where the chat tabs sit: a column on the conversation's left, or a strip above it
 *  showing each agent's mark alone (`top`) or with every tab's title (`top-titled`). */
export type ChatTabsSide = 'left' | 'top' | 'top-titled'

/** How every canvas draws a relationship: a curve between the cards, or right-angled traces. */
export type EdgeStyle = WorkspaceUiState['edgeStyle']

/** Which half of the work panel is showing. */
type PanelTab = WorkspacePanelUiState['tab']
/** Where the work panel lives. `left` and `right` dock a column beside the view;
 *  `bottom` spends a single composer-shaped bar on it and floats the conversation
 *  over the middle of the screen when you click in. */
export type PanelSide = WorkspacePanelUiState['side']

/** The bottom dock's size bounds, in px. The server clamps to the same ones. */
export const DOCK_WIDTH = { min: 420, max: 1600, fallback: 880 } as const
export const DOCK_HEIGHT = { min: 200, max: 1400, fallback: 560 } as const

/** Bounds the persisted projection holds the other panel sizes to. */
const PANEL_SIZE = { min: 260, max: 900 } as const
const RAIL_WIDTH = { min: 180, max: 560 } as const
const DETAIL_WIDTH = { min: 320, max: 900 } as const
/** The chat tab column's width bounds, in px. */
export const CHAT_TABS_WIDTH = { min: 120, max: 480, fallback: 160 } as const

function clampTo({ min, max }: { min: number; max: number }, value: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function loadStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T | null
    if (value && allowed.includes(value)) return value
  } catch {}
  return fallback
}

function loadStoredWidth(key: string, bounds: { min: number; max: number; fallback: number }) {
  try {
    const value = Number(localStorage.getItem(key))
    if (Number.isFinite(value) && value > 0) return clampTo(bounds, value)
  } catch {}
  return bounds.fallback
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
  /** The level the view reads. It is not persisted: opening the Studio lands on a Domain. */
  level: StudioLevel
  /** The Domain the levels read. It never scopes the agent or comments. */
  readerDomainId?: string
  /** The dataset the Data level reads, of `readerDomainId`, by its module path: the one name a
   *  dataset keeps whether it loads or not. Null reads its first ready one. Another Domain
   *  starts at null again. */
  dataset: string | null
  /** appearance preference, persisted in this browser */
  theme: Theme
  /** the theme actually painted — `system` resolved. Canvas colours that land in
   *  SVG attributes need a real value, not a CSS function. */
  resolvedTheme: 'light' | 'dark'
  /** edge drawing preference, persisted in this workspace's machine-side UI state */
  edgeStyle: EdgeStyle
  /** chat tab placement, persisted in this browser */
  chatTabsSide: ChatTabsSide
  /** the chat tab column's width when it sits on the left, persisted in this browser */
  chatTabsWidth: number
  /** the question the canvas answers — Structure, Behavior or Rules — persisted in this browser */
  lens: LensKey
  /** work panel: the agent conversation and the comment threads, docked beside the view.
   *  Docked bottom there is no column to expand — this is then the floating chat itself. */
  panelOpen: boolean
  panelTab: PanelTab
  panelSide: PanelSide
  /** panel width in px when docked left/right */
  panelSize: number
  /** The bottom dock's own size: its width, grown on both sides so it stays centred,
   *  and the height of the conversation it opens above the composer. */
  dockWidth: number
  dockHeight: number
  /** domains/modules rail furniture, scoped to this scanned workspace */
  modulesWidth: number
  detailWidth: number
  /** The widths the panels on the view's edges take — the rail on the left; the Inspector or
   *  an overview on the right — 0 where none is: the floating dock keeps to the canvas
   *  between them, so each panel has its full height. */
  asides: { left: number; right: number }
  modulesCollapsed: boolean
  /** What is typed in the agent composer, per chat. It lives here, not in the composer,
   *  so that closing the floating chat — or re-docking the panel — never throws a message
   *  away; and it is keyed by chat because a draft belongs to the agent it was written
   *  for. Switching tabs empties the field and coming back fills it again, which is the
   *  same message still being written, not a new one.
   *
   *  The `NO_CHAT` key holds what was typed before the chat list landed; `adoptAgentDraft`
   *  hands it to the first real chat, so an early keystroke is not lost either. */
  agentDrafts: Record<string, string>
  /** The open threads the user attached to the next agent turn, by id. None by default:
   *  an open thread is signalled beside the composer, and only rides a turn once chosen. */
  agentComments: string[]
  selectedClass?: string
  /**
   * Which domain `selectedClass` and `focusId` belong to. A class ref is LOCAL
   * (`class.Order`), and on a workspace canvas the same name exists in several frames —
   * so the selection carries its owner. There is no active-domain fallback.
   */
  selectionDomainId?: string
  /** graph focus: which node is pinned (dims non-neighbors). null = no focus. */
  focusId: string | null
  /** when set, the RIGHT PANEL shows a domain-level overlay (Views / Domains overview)
   *  instead of the selected-class detail. Cleared by selecting a class / navigating. */
  panelOverlay: {
    kind: 'views' | 'domains'
    /** Domains are local; Views may span the whole canvas. */
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
  /** The onboarding tour. It never opens by itself: Settings and ⌘K start it. */
  tourOpen: boolean
  setTheme: (theme: Theme) => void
  setEdgeStyle: (style: EdgeStyle) => void
  setChatTabsSide: (side: ChatTabsSide) => void
  /** Ask the canvas another question: the Schema canvas, read through `lens`. The selection stays. */
  setLens: (lens: LensKey) => void
  setChatTabsWidth: (width: number) => void
  /** Read the whole Workspace. Every way into a Domain reads its Schema again. */
  openWorkspace: () => void
  /** Read the shown Domain's Schema, the lens and selection kept. */
  openSchema: () => void
  /** Read a Domain's Schema. The selection stays when it is that Domain's: a round trip
   *  through the Workspace level comes back to it. */
  openDomain: (domainId: string) => void
  /** Read the dataset at module `path` through the lenses, the lens and selection kept; null
   *  reads the Domain's first ready one. `openSchema` goes back to the Schema. */
  openDataLevel: (path: string | null) => void
  setReaderDomain: (domainId?: string) => void
  setPanelOpen: (open: boolean) => void
  setPanelTab: (tab: PanelTab) => void
  setPanelSide: (side: PanelSide) => void
  setPanelSize: (size: number) => void
  setDockSize: (size: { width?: number; height?: number }) => void
  setModulesWidth: (width: number) => void
  setDetailWidth: (width: number) => void
  setAside: (side: 'left' | 'right', width: number) => void
  setModulesCollapsed: (collapsed: boolean) => void
  /** Write this chat's draft. `undefined` writes the pre-chat one — see `agentDrafts`. */
  setAgentDraft: (chatId: string | undefined, text: string) => void
  /** Give the pre-chat draft to a chat, once there is one to give it to. */
  adoptAgentDraft: (chatId: string) => void
  /** A closed chat takes its draft with it: nothing can be sent to it any more. */
  dropAgentDraft: (chatId: string) => void
  /** Replace the threads attached to the next agent turn — see `agentComments`. */
  setAgentComments: (ids: string[]) => void
  /** Jump to whatever an anchor points at: the Schema, the member that declares it selected
   *  and focused, and the anchor itself recorded in `revealedRef`. */
  revealAnchor: (ref: string, domainId: string) => void
  setPanelOverlay: (kind: 'views' | 'domains' | null, domainId?: string) => void
  /** `domainId` names the owner; it is required for a real selection. */
  selectClass: (n?: string, domainId?: string) => void
  /** select a class AND pin graph focus to it (toggles focus if same id) */
  focusClass: (id: string, domainId: string) => void
  /** Drop the selection and its graph focus — what clicking empty space means. Leaves an
   *  open overlay panel (Views / Domains) alone: it is not a selection. */
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
  setTourOpen: (b: boolean) => void
}

/** This chat's draft, or what was typed before there was a chat to key it by. */
export function agentDraftOf(drafts: Record<string, string>, chatId?: string): string {
  return drafts[chatId ?? NO_CHAT] ?? ''
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
  return selection.startsWith('class.') || selection.startsWith('function.') ? selection : null
}
/** What the canvas is asked to bring into view. An `edge.` ref stays an edge ref: the canvas
 *  frames the cards its paths run between, and knows to drop the request if it draws none. */
function revealPan(ref: string): string | null {
  return ref.startsWith('edge.') ? ref : revealFocus(ref)
}

/** What reading the Schema clears: an overlay, a reveal under way, an open thread. */
const schemaLevel = {
  level: 'domain',
  panelOverlay: null,
  revealedRef: null,
  revealTarget: null,
  openAnchorRef: null,
} as const satisfies Partial<UIState>

const initialTheme = loadStored('studio.theme', ['system', 'light', 'dark'] as const, 'system')
// The floating dock is where the panel starts: it costs the view nothing, and a
// first look at a domain should be the domain, not a column beside it.
export const useUI = create<UIState>((set) => ({
  level: 'domain',
  dataset: null,
  theme: initialTheme,
  resolvedTheme: paintTheme(initialTheme),
  edgeStyle: 'curved',
  chatTabsSide: loadStored('studio.chatTabs', ['left', 'top', 'top-titled'] as const, 'left'),
  chatTabsWidth: loadStoredWidth('studio.chatTabsWidth', CHAT_TABS_WIDTH),
  lens: loadStored(
    'studio.lens',
    LENS_NAMES.filter((name) => name.available).map((name) => name.id),
    'structure',
  ),
  // The bottom dock always starts closed: there, `panelOpen` is a modal over the
  // domain, and reopening one on load would hide the thing you came back to see.
  panelOpen: false,
  panelTab: 'agent',
  panelSide: 'bottom',
  panelSize: 360,
  dockWidth: DOCK_WIDTH.fallback,
  dockHeight: DOCK_HEIGHT.fallback,
  modulesWidth: 240,
  detailWidth: 420,
  asides: { left: 0, right: 0 },
  modulesCollapsed: false,
  agentDrafts: {},
  agentComments: [],
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
  tourOpen: false,
  setTheme: (theme) => {
    storeBrowserPreference('studio.theme', theme)
    set({ theme, resolvedTheme: paintTheme(theme) })
  },
  setEdgeStyle: (edgeStyle) => set({ edgeStyle }),
  setChatTabsSide: (chatTabsSide) => {
    storeBrowserPreference('studio.chatTabs', chatTabsSide)
    set({ chatTabsSide })
  },
  setLens: (lens) => {
    storeBrowserPreference('studio.lens', lens)
    set((s) => ({
      lens,
      ...(s.level === 'workspace'
        ? { level: 'domain' as const, panelOverlay: null, openAnchorRef: null }
        : {}),
    }))
  },
  setChatTabsWidth: (width) => {
    const chatTabsWidth = clampTo(CHAT_TABS_WIDTH, width)
    storeBrowserPreference('studio.chatTabsWidth', String(chatTabsWidth))
    set({ chatTabsWidth })
  },
  openWorkspace: () =>
    set({ level: 'workspace', panelOverlay: null, revealTarget: null, openAnchorRef: null }),
  openSchema: () => set(schemaLevel),
  openDomain: (domainId) =>
    set((s) => ({
      level: 'domain',
      readerDomainId: domainId,
      ...(domainId === s.readerDomainId ? {} : { dataset: null }),
      // the Domain read before, or the one the selection belongs to: the selection is still its
      ...(domainId === s.readerDomainId || domainId === s.selectionDomainId
        ? {}
        : { selectedClass: undefined, selectionDomainId: undefined, focusId: null }),
      panelOverlay: null,
      revealedRef: null,
      revealTarget: null,
      openAnchorRef: null,
    })),
  openDataLevel: (dataset) =>
    set({
      level: 'data',
      dataset,
      panelOverlay: null,
      revealedRef: null,
      revealTarget: null,
      openAnchorRef: null,
    }),
  setReaderDomain: (readerDomainId) =>
    set((s) => (readerDomainId === s.readerDomainId ? {} : { readerDomainId, dataset: null })),
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
  setDockSize: ({ width, height }) =>
    set((s) => ({
      dockWidth: width === undefined ? s.dockWidth : clampTo(DOCK_WIDTH, width),
      dockHeight: height === undefined ? s.dockHeight : clampTo(DOCK_HEIGHT, height),
    })),
  setModulesWidth: (modulesWidth) => set({ modulesWidth }),
  setDetailWidth: (detailWidth) => set({ detailWidth }),
  setAside: (side, width) =>
    set((s) => (s.asides[side] === width ? s : { asides: { ...s.asides, [side]: width } })),
  setModulesCollapsed: (modulesCollapsed) => set({ modulesCollapsed }),
  setAgentDraft: (chatId, text) =>
    set((s) => ({ agentDrafts: { ...s.agentDrafts, [chatId ?? NO_CHAT]: text } })),
  adoptAgentDraft: (chatId) =>
    set((s) => {
      const pending = s.agentDrafts[NO_CHAT]
      // Nothing waiting, or the chat is already being written to: leave both alone.
      if (!pending || s.agentDrafts[chatId]) return {}
      const { [NO_CHAT]: _dropped, ...rest } = s.agentDrafts
      return { agentDrafts: { ...rest, [chatId]: pending } }
    }),
  dropAgentDraft: (chatId) =>
    set((s) => {
      if (!(chatId in s.agentDrafts)) return {}
      const { [chatId]: _closed, ...rest } = s.agentDrafts
      return { agentDrafts: rest }
    }),
  setAgentComments: (agentComments) => set({ agentComments }),
  revealAnchor: (ref, domainId) => {
    // A property or method is revealed INSIDE the member that declares it — selecting
    // the field itself would select a canvas node that does not exist.
    const selection = detailRefFor(ref)
    set({
      level: 'domain',
      panelOverlay: null,
      revealedRef: ref,
      selectionDomainId: domainId,
      ...(selection.startsWith('class.') ||
      selection.startsWith('edge.') ||
      selection.startsWith('function.') ||
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
    })
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
        focusId:
          selectedClass?.startsWith('class.') || selectedClass?.startsWith('function.')
            ? selectedClass
            : owner === s.selectionDomainId
              ? s.focusId
              : null,
      }
    }),
  focusClass: (id, domainId) =>
    set((s) => {
      const same = s.focusId === id && s.selectionDomainId === domainId
      return {
        selectedClass: id,
        selectionDomainId: domainId,
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
  setTourOpen: (tourOpen) => set({ tourOpen }),
}))

/**
 * The Domain the levels read: the reader's, else the selection's, else the Workspace's first.
 * Each must be one there is to read — a Domain of the Workspace, or a Publication by its id.
 */
export function shownDomainId(
  state: Pick<UIState, 'readerDomainId' | 'selectionDomainId'>,
  domains: readonly { id: string }[],
): string | undefined {
  const readable = (domainId?: string) =>
    domainId &&
    (publicationOf(domainId) !== undefined || domains.some((domain) => domain.id === domainId))
      ? domainId
      : undefined
  return readable(state.readerDomainId) ?? readable(state.selectionDomainId) ?? domains[0]?.id
}

/**
 * The small persistent projection of the UI store; transient selections stay in memory. A
 * Publication read is not a Domain of the Workspace: the last one read stays the one a bare
 * `/` opens, and the address alone says the Publication.
 */
export function uiWorkspaceSnapshot(): Pick<
  WorkspaceUiState,
  'edgeStyle' | 'panel' | 'rail' | 'detailWidth'
> & {
  readerDomainId?: string | null
} {
  const state = useUI.getState()
  const reader = state.readerDomainId
  return {
    edgeStyle: state.edgeStyle,
    detailWidth: clampTo(DETAIL_WIDTH, state.detailWidth),
    ...(reader !== undefined && publicationOf(reader) ? {} : { readerDomainId: reader ?? null }),
    panel: {
      open: state.panelOpen,
      tab: state.panelTab,
      side: state.panelSide,
      size: clampTo(PANEL_SIZE, state.panelSize),
      dockWidth: clampTo(DOCK_WIDTH, state.dockWidth),
      dockHeight: clampTo(DOCK_HEIGHT, state.dockHeight),
    },
    rail: {
      width: clampTo(RAIL_WIDTH, state.modulesWidth),
      collapsed: state.modulesCollapsed,
    },
  }
}

/** Install the server-owned workspace state without disturbing transient interaction state. */
export function hydrateWorkspaceUi(state: WorkspaceUiState): void {
  useUI.setState({
    edgeStyle: state.edgeStyle,
    readerDomainId: state.readerDomainId,
    panelOpen: state.panel.side === 'bottom' ? false : state.panel.open,
    panelTab: state.panel.tab,
    panelSide: state.panel.side,
    panelSize: state.panel.size,
    dockWidth: state.panel.dockWidth,
    dockHeight: state.panel.dockHeight,
    modulesWidth: state.rail.width,
    detailWidth: state.detailWidth ?? 420,
    modulesCollapsed: state.rail.collapsed,
  })
}

// Following the OS means following it live, not only at boot.
globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useUI.getState().theme === 'system') useUI.setState({ resolvedTheme: paintTheme('system') })
})
