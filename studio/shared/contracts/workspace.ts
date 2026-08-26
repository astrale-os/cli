/**
 * Shared workspace and persisted-state contracts.
 *
 * This module owns the JSON shapes written below `.domain-studio/` and the
 * workspace summaries derived around them. Server stores consume these types;
 * they do not redeclare the persisted state.
 */

import type { SchemaRevision } from './schema'

/** A kernel instance the CLI knows about (a local bookmark or an admin-managed one). */
export interface InstanceInfo {
  name: string
  url: string
  active: boolean
  kind: 'bookmark' | 'managed'
}

/** Global (NOT per-domain) — the CLI's instances + which is active. Source of truth: `astrale instance list`. */
export interface InstancesState {
  active: string | null
  instances: InstanceInfo[]
}

/** What the studio recorded the last time it ran a deploy for this domain. */
export interface DeployRecord {
  at: string
  /** UI/cache fingerprint recorded by Studio; not a canonical schema revision. */
  renderFingerprint: string
  ok: boolean
  url?: string
}

/** Per-domain deploy/install state (the active instance is global — see InstancesState). */
export interface InstanceStatus {
  /** the domain's configured deploy target (astrale.config.ts prod.instance) */
  deployTarget: string | null
  /** has a `prod` script → deployable via `pnpm prod` */
  deployable: boolean
  /** GROUND TRUTH — queried from `astrale introspect <origin> --bundle`, not local state.
   *  'unknown' = the instance couldn't be reached/queried (no target, not authed, offline). */
  install: 'installed' | 'not-installed' | 'unknown'
  /** local schema vs the schema actually INSTALLED on the instance (ground truth) */
  drift: 'in-sync' | 'drifted' | 'unknown'
  /** Canonical revisions compared only after local and installed SDK admission. */
  localRevision: SchemaRevision | null
  installedRevision: SchemaRevision | null
  /** the studio's own last deploy — supplementary (service URL / when), not the source of truth */
  lastDeploy: DeployRecord | null
}

export interface DeployResult {
  ok: boolean
  url: string | null
  output: string
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

export type AnchorKind = 'schema' | 'section' | 'file' | 'free'

export interface AnchorRef {
  ref: string
  kind: AnchorKind
  file?: string
  startLine?: number
  endLine?: number
  label?: string
  /** Flow-canvas coordinates for section-level canvas comments. */
  x?: number
  y?: number
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
  | 'view-changed'
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

export interface ChangeSet {
  source: 'baseline' | 'git'
  hasGit: boolean
  hasBaseline: boolean
  schemaChanges: SchemaChange[]
  fileChanges: FileChange[]
  schemaDiffText?: string
  /** Describes Studio-observed structure only; never a Runtime migration verdict. */
  structuralStatus: 'none' | 'changed'
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

/** Where context documents live inside a domain — shown in the UI, read by the agent. */
export const DOCUMENTS_DIR = '.domain-studio/context/docs'

export interface Integration {
  id: string
  name: string
  kind: string
  status: 'planned' | 'active' | 'deprecated' | string
  notes?: string
}

export interface IntegrationsState {
  integrations: Integration[]
  detectedSubfolders: string[]
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

export interface CopyPayload {
  markdown: string
  openComments: number
}

export interface NodePosition {
  x: number
  y: number
  /** persisted size — only expanded module containers carry one. */
  w?: number
  h?: number
}

/** Persisted manual graph layout. This is the sole authority for its JSON shape. */
export interface LayoutState {
  renderFingerprint?: string
  positions: Record<string, NodePosition>
}

/** Persisted per-domain canvas visibility. This is the sole authority for its JSON shape. */
export interface VisibilityState {
  /** Refs hidden on the canvas: `class.X` | `edge.X` | `domain.<origin>`. */
  hidden: Record<string, true>
  /** Whether local Class inheritance edges are rendered. */
  showInheritedEdges: boolean
}
