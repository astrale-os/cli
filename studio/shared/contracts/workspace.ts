/**
 * Shared workspace and persisted-state contracts.
 *
 * This module owns the JSON shapes written below `.domain-studio/`, the machine-side
 * UI state for one scanned workspace, and workspace summaries derived around them.
 * Server stores consume these types; they do not redeclare persisted state.
 */

import type { SchemaRevision } from './schema'

import { PUBLISHED_DOMAIN_PREFIX, publicationOf, type PublicationAddress } from './versions'

/** A kernel instance the CLI knows about (a local bookmark or an admin-managed one). */
export interface InstanceInfo {
  name: string
  url: string
  active: boolean
  kind: 'bookmark' | 'managed'
  /**
   * The user owns the Admin Instance behind this entry, in the Admin sense: the Admin Policy
   * `OwnInstanceOrAdministerAdminInstance`. Studio works only with owned instances; the others
   * stay listed, but cannot be selected.
   */
  owned: boolean
  /** Why an entry is not owned, shown beside it: `Not owner`, `Not an Admin instance`, … */
  reason?: string
}

/** Global (NOT per-domain) — the CLI's instances + which is active. Source of truth: `astrale instance list`. */
export interface InstancesState {
  active: string | null
  instances: InstanceInfo[]
}

/** One Domain installed on an instance, as `astrale domain list -i <instance> --json` names it. */
export interface InstanceDomain {
  origin: string
  /** The registry version of the installed release, when one names it. */
  version?: string
  /** The deployment's printed name: the version, a preview name, `local` or `unknown`. */
  name: string
  /** The deployment URL; absent for a local install. */
  url?: string
  /** The highest stable version above the installed one, when one is known. */
  available?: string
}

/** What runs on one instance, or why it could not be read. */
export interface InstanceDomains {
  ok: boolean
  domains: InstanceDomain[]
  error?: string
}

export type ThreadRole = 'user' | 'author'
export type ThreadEntryType = 'text' | 'choice'

export interface ThreadEntry {
  id: string
  role: ThreadRole
  type: ThreadEntryType
  text: string
  options?: string[]
  answer?: string | null
}

export type AnchorKind = 'schema' | 'section' | 'file'

export interface AnchorRef {
  ref: string
  kind: AnchorKind
  file?: string
  startLine?: number
  endLine?: number
  label?: string
}

export interface Comment {
  id: string
  /** annotate-compatible: array of string excerpts */
  anchors: string[]
  /** studio-only, index-aligned to `anchors` */
  anchorRefs: AnchorRef[]
  status: 'open' | 'closed'
  closeNote?: string
  thread: ThreadEntry[]
  createdAt: string
  /** derived: a thread whose first entry is role:'author' is a question */
  kind: 'comment' | 'question'
  /** set when the anchor ref no longer resolves against the current schema */
  orphaned?: boolean
}

export interface CommentStore {
  /** Historical annotate wire key; contains Studio's render fingerprint. */
  schemaVersion: string
  comments: Comment[]
}

export interface MergeResult {
  merged: number
  closed: number
  unknownIds: string[]
  schemaMismatch: boolean
  pastedSchemaVersion?: string
}

export type SchemaChangeKind =
  | 'schema-metadata-changed'
  | 'import-added'
  | 'import-removed'
  | 'import-changed'
  | 'class-added'
  | 'class-removed'
  | 'class-contract-changed'
  | 'edge-added'
  | 'edge-removed'
  | 'edge-contract-changed'
  | 'definition-metadata-changed'
  | 'prop-added'
  | 'prop-removed'
  | 'prop-type-changed'
  | 'prop-schema-changed'
  | 'prop-required-changed'
  | 'method-added'
  | 'method-removed'
  | 'method-signature-changed'
  | 'method-metadata-changed'
  | 'function-added'
  | 'function-removed'
  | 'function-signature-changed'
  | 'function-metadata-changed'
  | 'view-added'
  | 'view-removed'
  | 'view-metadata-changed'
  | 'policy-added'
  | 'policy-removed'
  | 'policy-changed'
  | 'dependency-added'
  | 'dependency-removed'
  | 'dependency-changed'
  | 'core-changed'

export interface SchemaChange {
  kind: SchemaChangeKind
  target: string
  detail?: string
}

export interface FileChange {
  file: string
  status: 'added' | 'modified' | 'removed'
}

/**
 * The current Schema beside the baseline's, as the Studio observes its structure; never a Runtime
 * migration verdict. An extraction that holds no Schema compares nothing: it is unread, and says
 * why, instead of reading as unchanged.
 */
export type SchemaComparison =
  | { state: 'unchanged' }
  | { state: 'changed'; changes: SchemaChange[] }
  | { state: 'unread'; reason: string }

export interface ChangeSet {
  source: 'baseline' | 'git'
  hasGit: boolean
  hasBaseline: boolean
  schema: SchemaComparison
  fileChanges: FileChange[]
  schemaDiffText?: string
  baselineRevision?: SchemaRevision
  currentRevision?: SchemaRevision
  baselineCapturedAt?: string
}

export interface ContextItem {
  id: string
  bucket: 'user' | 'auto'
  title: string
  body: string
  source?: string
  updatedAt: string
  /** auto items: included in the copy payload only when true */
  includeInHandoff?: boolean
  freshness?: string
}

export interface ContextStore {
  user: ContextItem[]
  auto: ContextItem[]
}

/** A document the user drops in as context for the AI agent. */
export interface DocMeta {
  id: string
  name: string
  type: string
  size: number
  addedAt: string
  updatedAt?: string
  /** relative path under the dotted folder (server-side) */
  stored: string
}

/** A domain in the catalog — local to this workspace, a faked external service, or the kernel. */
export interface DomainCatalogEntry {
  origin: string
  name: string
  kind: 'kernel' | 'local' | 'external'
  description: string
  /** raw lucide-style SVG icon (stroke="currentColor") */
  icon: string
  /** kernel is always present + required */
  required?: boolean
}

export interface DomainSummary {
  id: string
  origin: string
  path: string
  schemaDir: string
  depsInstalled: boolean
  hasGit: boolean
  configFile: string
}

/** Machine-side work-panel placement for one scanned workspace. */
export interface WorkspacePanelUiState {
  open: boolean
  tab: 'agent' | 'comments'
  side: 'left' | 'right' | 'bottom'
  size: number
  /** Width of the centred bottom dock; it grows on both sides and stays centred. */
  dockWidth: number
  /** Height of the conversation the bottom dock opens above its composer. */
  dockHeight: number
}

/** Machine-side placement of the domains/modules rail. */
export interface WorkspaceRailUiState {
  width: number
  collapsed: boolean
}

/**
 * UI state belongs to the machine, but is isolated by scanned workspace. It is
 * deliberately not written into any domain: domains only own domain artifacts.
 */
/** What the workspace's UI state may hold: a patch past one is refused (413). */
export const WORKSPACE_UI_LIMITS = {
  /** the reader Domain's id, in characters */
  readerDomainId: 512,
} as const

export interface WorkspaceUiState {
  version: 1
  /** The Domain the Schema and the Data level read; this is not an active domain. */
  readerDomainId?: string
  /** How relationship edges are drawn across the workspace canvases. */
  edgeStyle: 'curved' | 'orthogonal'
  /** Width of the shared right-hand detail panel; absent in older saved states. */
  detailWidth?: number
  panel: WorkspacePanelUiState
  rail: WorkspaceRailUiState
}

export interface NodePosition {
  x: number
  y: number
  /** persisted size — only expanded module containers carry one. */
  w?: number
  h?: number
}

/**
 * A canvas's persisted arrangement: a Domain's, the Kernel's, or the Workspace map's
 * (`WORKSPACE_MAP_ID`). This is the sole authority for its JSON shape.
 */
export interface LayoutState {
  renderFingerprint?: string
  /**
   * Each Studio lens's own arrangement, by lens id: a placed box's top-left by box id, in
   * the lens canvas's world units. Lenses never share positions.
   */
  lenses?: Record<string, Record<string, NodePosition>>
  /**
   * Each Studio lens's shut modules, by lens id: their group ids, sorted. An empty list is
   * every module open; a lens absent here shows its scene's default.
   */
  collapsed?: Record<string, string[]>
  /**
   * Each Studio lens's folds the reader opened by hand, by lens id: their ids, sorted, each
   * laid out open. A lens absent here, or a fold not named, shows its scene's default.
   */
  opened?: Record<string, string[]>
  /**
   * How each Studio lens draws the other Domains, by lens id, then by Domain origin: `hidden`
   * draws none of its Classes, `whole` draws all of them in an area of their own. A Domain absent
   * here shows only the Classes the canvas's own Domain reaches.
   */
  domains?: Record<string, Record<string, DomainShare>>
}

/** How much of another Domain a canvas draws, past what its own Domain reaches. */
export type DomainShare = 'hidden' | 'whole'

export const DOMAIN_SHARES: readonly DomainShare[] = ['hidden', 'whole']

/**
 * What a layout record may hold, in counts and characters. A write past one is refused (413)
 * and a file past one is not read whole — never cut down to fit.
 */
export const LAYOUT_LIMITS = {
  /** lenses arranged per record */
  lenses: 16,
  /** boxes placed per lens */
  positions: 10_000,
  /** ids per set a lens keeps: its shut modules, its folds opened by hand */
  ids: 10_000,
  /** a box's, a module's or a fold's id, or a Domain's origin */
  id: 512,
  /** other Domains a lens says how to draw */
  domains: 256,
  /** a coordinate or a size, either way from 0, in world units */
  coordinate: 10_000_000,
} as const

/**
 * What one request's body may weigh, in bytes, on every route that reads one. A body past its
 * bound is refused (413) — before it is read when it declares its length, as it arrives
 * otherwise — never cut down to fit. The record limits above apply within it.
 */
export const REQUEST_LIMITS = {
  /** a JSON body: a write, an agent message, a bridge call */
  json: 4 * 1024 * 1024,
  /** a multipart body: one chat image, or the files one Documents upload sends together */
  upload: 32 * 1024 * 1024,
} as const

/** Origin of the Kernel Domain every Domain is built on. */
export const KERNEL_ORIGIN = 'kernel.astrale.ai'

/**
 * Studio's id for the read-only Kernel Domain. Not a workspace Domain: it has no project on
 * disk, so it never appears in `/api/workspace`. Workspace ids are `<name>-<hash>`, so this
 * one cannot collide with them.
 */
export const KERNEL_DOMAIN_ID = '@kernel'

/**
 * What a Domain id names, read from the id alone: a workspace Domain (`<folder>-<8 hex>`, as the
 * server keys a project), the Kernel (`KERNEL_DOMAIN_ID`), one Publication
 * (`@registry:<origin>@<version>`), or nothing (`invalid`). Whether a workspace Domain of that id
 * is registered is the server's to say.
 */
export type DomainAddress =
  | { readonly kind: 'workspace'; readonly id: string }
  | { readonly kind: 'kernel' }
  | ({ readonly kind: 'publication' } & Readonly<PublicationAddress>)
  | { readonly kind: 'invalid' }

/** A workspace Domain's id: its project folder's name made safe (1–40 characters), `-`, and 8 hex digits of its path. */
const WORKSPACE_DOMAIN_ID = /^[A-Za-z0-9._-]{1,40}-[0-9a-f]{8}$/

/** The one reading of a Domain id; every other test of an id derives from it. */
export function domainAddressOf(domainId: string): DomainAddress {
  if (domainId === KERNEL_DOMAIN_ID) return { kind: 'kernel' }
  if (domainId.startsWith(PUBLISHED_DOMAIN_PREFIX)) {
    const publication = publicationOf(domainId)
    return publication ? { kind: 'publication', ...publication } : { kind: 'invalid' }
  }
  return WORKSPACE_DOMAIN_ID.test(domainId)
    ? { kind: 'workspace', id: domainId }
    : { kind: 'invalid' }
}

/**
 * Whether a Domain id names a Domain the Studio only reads: the Kernel, or a Publication. Neither
 * has sources on disk, so nothing edits, comments on or publishes it, and its arrangement is kept
 * on this machine. The server refuses those writes in one place (`api.ts`), and every write to an
 * id that names nothing.
 */
export function isReadOnlyDomainId(domainId: string): boolean {
  const { kind } = domainAddressOf(domainId)
  return kind === 'kernel' || kind === 'publication'
}

/**
 * The Workspace map's id where a canvas names whose layout record it reads. The map names no
 * Domain: its record is the scanned workspace's, kept on this machine (`/api/workspace/layout`).
 */
export const WORKSPACE_MAP_ID = '@workspace'
