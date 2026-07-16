/**
 * shared/types.ts — the ONE contract shared by the Bun server and the React
 * client. Shapes under "DSL Schema IR" mirror EXACTLY what `D.$.ir` /
 * `serialize(schema)` emit (verified empirically against my-domain + evaluation):
 *   ir = { version, domain, types, interfaces, classes, imports }
 *   class = { type:'node'|'edge', name, implements?, endpoints?(edge), properties, methods }
 *   interface = { type:'interface', name, extends?, properties, methods }
 *   method = { name, params:{name->JsonSchema}, returns:JsonSchema, static, inheritance }
 *   imports = { name -> { origin, definition:'interface'|'class' } }
 * Everything under "Studio overlay/state" is the studio's own augmentation.
 */

// ───────────────────────────── DSL Schema IR ─────────────────────────────

export interface JsonSchema {
  type?: string | string[]
  enum?: (string | number | boolean | null)[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  additionalProperties?: boolean
  minimum?: number
  maximum?: number
  format?: string
  description?: string
  $nodeRef?: unknown
  $dataRef?: unknown
  [k: string]: unknown
}

export type MethodInheritance = 'default' | 'abstract' | 'sealed'

export interface IrMethod {
  name: string
  params: Record<string, JsonSchema>
  returns: JsonSchema
  static: boolean
  inheritance: MethodInheritance
}

export interface IrInterface {
  type: 'interface'
  name: string
  extends?: string[]
  properties: Record<string, JsonSchema>
  methods: Record<string, IrMethod>
}

export interface IrEndpoint {
  name: string
  types: string[]
  /** declared multiplicity for this end; max:null = unbounded ("many"). Absent ⇒ unconstrained. */
  cardinality?: { min: number; max: number | null }
}

export interface IrClass {
  type: 'node' | 'edge'
  name: string
  implements?: string[]
  /** edges only: the two (source,target) endpoints with role names + allowed types */
  endpoints?: IrEndpoint[]
  properties: Record<string, JsonSchema>
  methods: Record<string, IrMethod>
  /** class-level icon: raw (lucide-style) SVG markup, `stroke="currentColor"` */
  icon?: string
}

export interface IrImportDescriptor {
  origin: string
  definition: 'interface' | 'class'
}

export interface SchemaIR {
  version: string
  domain: string
  types: Record<string, JsonSchema>
  interfaces: Record<string, IrInterface>
  classes: Record<string, IrClass>
  imports: Record<string, IrImportDescriptor>
}

// ─────────────────────────── Studio schema overlay ───────────────────────────

export interface HandlerLink {
  owner: string
  ownerKind: 'class' | 'interface'
  method: string
  static: boolean
  /** the runtime/index.ts wiring site */
  wiringFile?: string
  wiringLine?: number
  /** the resolved handler file (followed from the `execute` import) */
  handlerFile?: string
  handlerLine?: number
  /** kernel ops detected in the handler (::update, ::link, createNode, …) */
  kernelCalls?: string[]
  /** declared auth policy on the runtime config; absent ⇒ defaults to 'required'. */
  auth?: 'public' | 'optional' | 'required'
  /** authorize hook shape: 'absent' (none), 'noop' (allow-all), 'custom' (real check). */
  authorize?: 'absent' | 'noop' | 'custom'
  /** raw source of the authorize hook (for the hover preview). */
  authorizeSnippet?: string
  /** false ⇒ a todo()/NotImplemented stub → "contract-only" badge */
  implemented: boolean
  /** true ⇒ resolver could not link a file → "unlinked" badge */
  unlinked?: boolean
}

export interface SourceSpan {
  file: string
  startLine: number
  endLine: number
  doc?: string
}

export interface SchemaAnnotation {
  /** anchor ref key, e.g. 'class.Monitor.property.status' */
  target: string
  severity: 'warn' | 'info'
  code: 'ENUM_DROPPED_BY_UPDATE' | 'COMPILE_ERROR' | 'EDGE_PROP_TYPE_MISSING'
  message: string
}

export interface CrossDomainImport {
  name: string
  origin: string
  definition: 'interface' | 'class'
}

export interface SchemaOverlay {
  origin: string
  /** defineDomain({ requires }) — runtime domain dependencies */
  requires: string[]
  /** non-kernel ir.imports → true cross-domain imports */
  crossDomainImports: CrossDomainImport[]
  /** kernel-origin ir.imports → mixin interfaces (collapsed chip) */
  mixins: CrossDomainImport[]
  postInstall?: string
  handlerLinks: HandlerLink[]
  /** keyed by anchor ref (class.X / class.X.property.y / class.X.method.m / edge.e / interface.I…) */
  sourceSpans: Record<string, SourceSpan>
  annotations: SchemaAnnotation[]
}

export interface BundleError {
  message: string
  file?: string
}

export interface StudioSchemaBundle {
  domainId: string
  schemaHash: string
  extractedBy: 'runtime-bun' | 'static-tsmorph-fallback'
  depsInstalled: boolean
  ir: SchemaIR | null
  overlay: SchemaOverlay
  /**
   * Member bodies of the interfaces this domain IMPORTS — kernel mixins (Named,
   * Iconable, Timestamped…) and cross-domain interfaces (e.g. Notifiable). The
   * serializer drops these from `ir` (they appear in `ir.imports` as
   * {origin,definition} descriptors only), so the extractor re-serializes each
   * imported schema to recover them. Keyed by interface name; the origin lives in
   * `ir.imports[name]`. Lets the detail pane surface inherited members like
   * Named→name without re-parsing the kernel. Empty when deps aren't installed.
   */
  importedInterfaces?: Record<string, IrInterface>
  /** present when the runtime import failed to compile (render state, not a crash) */
  error?: BundleError | null
  extractedAt: string
}

// ─────────────────────────── Domain anatomy (non-schema) ───────────────────────────

export interface DomainOverview {
  origin: string
  adapter: 'astrale' | 'cloudflare' | 'unknown'
  prodTarget?: string
  devSecrets?: string
  postInstall?: string
  requires: string[]
  packageName?: string
  packageVersion?: string
  astraleDeps: Record<string, string>
  schemaDir: string
  client?: string
}

export interface ViewInfo {
  slug: string
  kind: 'inline-html' | 'spa' | 'unknown'
  auth?: string
  mount?: string
  url?: string
  /** the class(es) this view binds to via `viewFor: selfOf(Class)` (DSL allows an array);
   *  absent ⇒ unbound/global */
  viewFor?: string | string[]
  file?: string
  description?: string
}

/** One node that can be supplied as a targeted view's `targetNodeId`. */
export interface ViewTargetCandidate {
  id: string
  ref: string
  className: string
  classOrigin: string
  label: string
  description?: string
  status?: string
}

/** Small durable snapshot retained when a previously selected node disappears. */
export interface RememberedViewTarget {
  id: string
  className: string
  classOrigin: string
  label: string
}

export type ViewDevServerStatus =
  | {
      status: 'running'
      url: string
      port: number
      startedAt: string
      idleTimeoutMs: number
    }
  | { status: 'failed'; reason: string }
  | { status: 'unavailable'; reason: string }

export interface ViewTargetResult {
  status: 'available' | 'unavailable'
  items: ViewTargetCandidate[]
  selected: ViewTargetCandidate | null
  stale: RememberedViewTarget | null
  truncated: boolean
  reason?: string
}

/** Full launch context shown before Studio asks `astrale view` to open locally. */
export interface ViewRuntime {
  slug: string
  instance: string | null
  targetRequired: boolean
  server: ViewDevServerStatus
  targets: ViewTargetResult
}

export type ViewSessionResult =
  | {
      status: 'ready'
      sessionId: string
      pageUrl: string
      viewUrl: string
      target: ViewTargetCandidate | null
    }
  | { status: 'unavailable'; reason: string }

export interface ClientFeature {
  name: string
  files: string[]
}

export interface ClientTree {
  shell: string[]
  features: ClientFeature[]
  routes: Record<string, string>
  present: boolean
}

export interface EnvField {
  name: string
  optional: boolean
  doc?: string
  secret?: boolean
}

export type EnvName = 'dev' | 'prod'

/** One env var in the editor: the env.ts contract side (declared/optional/doc)
 *  merged with the `.env.<env>` file side (value). A row may be declared-only
 *  (in env.ts, not yet in the file), set, or an orphan (in the file, not env.ts). */
export interface EnvVarRow {
  name: string
  /** current value from `.env.<env>` ('' when unset or empty) */
  value: string
  /** declared as a fillable (non-binding) field in env.ts's Env interface */
  declared: boolean
  /** env.ts marks it optional (`?`). Only required (!optional) + empty raises the signal. */
  optional: boolean
  /** JSDoc on the env.ts field — the inline hint */
  doc?: string
}

/** The editable env for one env name (dev|prod): the `.env.<env>` file reconciled
 *  against env.ts. The GUI is the read-only studio's one sanctioned writer of a
 *  domain file (the explicit exception). */
export interface EnvFileModel {
  env: EnvName
  /** the secrets file, relative to the domain root (e.g. '.env.dev') */
  file: string
  /** wired via `astrale.config.ts` (`secrets: '.env.<env>'`)? false ⇒ the file is used
   *  by convention but the adapter isn't pointed at it (e.g. managed prod). */
  configured: boolean
  exists: boolean
  adapter: DomainOverview['adapter']
  rows: EnvVarRow[]
  /** declared && required && empty — the count the "needs values" signal shows */
  requiredMissing: number
}

export interface DomainAnatomy {
  overview: DomainOverview
  views: ViewInfo[]
  client: ClientTree
  env: EnvField[]
  depsContainer?: string
  /** shallow readdir of integrations/ top-level dir names — a hint, NOT a parse */
  detectedIntegrations: string[]
}

// ─────────────────────────── Instance / deploy ───────────────────────────

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

/** What the studio recorded the last time IT ran a deploy for this domain. */
export interface DeployRecord {
  at: string
  schemaHash: string
  ok: boolean
  url?: string
}

/** Per-domain deploy/install state (the active instance is global — see InstancesState). */
export interface InstanceStatus {
  /** the domain's configured deploy target (astrale.config.ts prod.instance) */
  deployTarget: string | null
  /** has a `prod` script → deployable via `pnpm prod` */
  deployable: boolean
  /** GROUND TRUTH — queried from the target instance (`astrale get /<origin>`), not local state.
   *  'unknown' = the instance couldn't be reached/queried (no target, not authed, offline). */
  install: 'installed' | 'not-installed' | 'unknown'
  /** local schema vs the schema actually INSTALLED on the instance (ground truth) */
  drift: 'in-sync' | 'drifted' | 'unknown'
  localHash: string | null
  /** hash of the schema installed on the instance (when reachable + installed) */
  installedHash: string | null
  /** the studio's own last deploy — supplementary (service URL / when), not the source of truth */
  lastDeploy: DeployRecord | null
}

export interface DeployResult {
  ok: boolean
  url: string | null
  output: string
}

// ─────────────────────────── Comments / open-questions ───────────────────────────

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

// ─────────────────────────── Change tracking ───────────────────────────

export type SchemaChangeKind =
  | 'class-added'
  | 'class-removed'
  | 'interface-added'
  | 'interface-removed'
  | 'edge-added'
  | 'edge-removed'
  | 'prop-added'
  | 'prop-removed'
  | 'prop-type-changed'
  | 'prop-required-changed'
  | 'method-added'
  | 'method-removed'
  | 'method-signature-changed'

export interface SchemaChange {
  kind: SchemaChangeKind
  target: string
  detail?: string
  breaking: boolean
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
  classification: 'none' | 'additive' | 'breaking'
  baselineCapturedAt?: string
}

// ─────────────────────────── Core (genesis) data ───────────────────────────
// A domain's `core` is its baked-in genesis graph: the concrete node/edge
// instances `defineCore(schema, { nodes, edges })` ships in the install bundle.
// Read-only here — the studio renders it and lets you comment to request changes.

/** One materialized node instance in a domain's core graph. */
export interface StudioCoreNode {
  /** stable slash-path identity, e.g. `/big-shop.example.dev/core/brands/acme` (also the comment anchor key) */
  path: string
  /** the IR class this node instantiates (keys into StudioSchemaBundle.ir.classes) */
  className: string
  /** the node's property values, keyed by (possibly owner-qualified) property name */
  data: Record<string, unknown>
  /** parent node's `path`, when nested under another node (absent for roots) */
  parent?: string
}

/** One materialized edge instance wiring two core nodes. */
export interface StudioCoreEdge {
  /** source node `path` (or `self(ClassName)` for a meta-node endpoint) */
  from: string
  /** target node `path` (or `self(ClassName)`) */
  to: string
  /** the IR edge class name (keys into StudioSchemaBundle.ir.classes, type:'edge') */
  edgeName: string
  /** edge property values, when the edge class carries data */
  data?: Record<string, unknown>
}

/** A domain's core data: the concrete genesis node/edge instance graph. */
export interface StudioCore {
  /** the domain origin this core graph belongs to (mirrors SchemaIR.domain) */
  domain: string
  nodes: StudioCoreNode[]
  edges: StudioCoreEdge[]
  /** set when extraction failed; null when extraction succeeded (including "no core defined") */
  error?: { message: string } | null
  extractedAt: string
}

// ─────────────────────────── Context ───────────────────────────

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

// ─────────────────────────── Integrations ───────────────────────────

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

// ─────────────────────────── Domain summary / workspace ───────────────────────────

export interface DomainSummary {
  id: string
  origin: string
  path: string
  schemaDir: string
  depsInstalled: boolean
  hasGit: boolean
  configFile: string
}

// ─────────────────────────── Copy payload ───────────────────────────

export interface CopyPayload {
  markdown: string
  openComments: number
}

// ─────────────────────────── Agent loop (live, harness-agnostic) ───────────────────────────

/** Kinds of activity the studio surfaces while a local agent runs a turn. */
export type AgentEventKind =
  | 'status' //   lifecycle / human note ("session started", "merged 2 replies")
  | 'thinking' // assistant reasoning (summarized)
  | 'message' //  assistant prose addressed to the user
  | 'tool' //     a tool invocation (edit, bash, read, …)
  | 'reply' //    the agent posted a reply to a specific thread (via the bridge)
  | 'error'

export interface AgentEvent {
  id: string
  ts: string
  kind: AgentEventKind
  text: string
  /** for kind:'tool' — the tool name (Edit/Write/Bash/Read…) */
  tool?: string
  /** for kind:'tool' — a compact target (file path, command, pattern) */
  target?: string
  /** for kind:'reply' — the comment id the reply landed on */
  commentId?: string
}

export const AGENT_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type AgentEffort = (typeof AGENT_EFFORT_LEVELS)[number]
export const AGENT_ACCESS_LEVELS = ['workspace', 'full'] as const
export type AgentAccess = (typeof AGENT_ACCESS_LEVELS)[number]

export interface AgentPromptSnapshot {
  createdAt: string
  /** appended to the harness default system prompt */
  systemPrompt: string
  /** piped to the harness on stdin */
  turnPrompt: string
  /** true when this turn started a new harness conversation */
  firstTurn: boolean
  /** true when this turn used a prior harness session id */
  resumed: boolean
  sessionId?: string
  /** Explicit Studio model override used for this turn; absent means harness-native default. */
  model?: string
  /** Harness-native reasoning effort used for this turn. */
  effort?: AgentEffort
  /** Filesystem/network authority granted to the harness for this turn. */
  access?: AgentAccess
  /** generated MCP bridge tools exposed to the harness for live write-back */
  mcpTools: string[]
}

export interface AgentSystemPromptInfo {
  bridge: boolean
  systemPrompt: string
}

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  /** the studio process died mid-turn (restart/crash) — the spawned agent went with
   *  it, but the CONVERSATION is preserved, so the next submit resumes it. */
  | 'interrupted'

/** One agent turn for a domain: the live transcript + outcome. */
export interface AgentRun {
  id: string
  domainId: string
  harness: string
  status: AgentRunStatus
  createdAt: string
  finishedAt?: string
  /** the harness session id (so the next turn resumes the same conversation) */
  sessionId?: string
  /** true ⇒ this turn resumed an existing conversation (vs. started a new one) */
  resumed?: boolean
  /** short human label of what this turn was asked to do */
  summary: string
  /** comment ids this turn was started to answer */
  targetCommentIds: string[]
  events: AgentEvent[]
  costUsd?: number
  numTurns?: number
  /** total token usage reported by the harness for this turn */
  tokens?: number
  error?: string
  /** how many threads the agent answered live via the bridge tools this turn */
  liveReplies?: number
  /** result of merging the agent's final machine-state reply block, if any */
  merge?: MergeResult
  /** exact prompt inputs sent to the harness for this turn */
  prompt?: AgentPromptSnapshot
}

/** The ongoing, resumable conversation for a domain and selected harness.
 *  Survives studio restarts (persisted on disk). */
export interface ConversationInfo {
  /** a resumable session exists → the next submit continues it (vs. starting fresh) */
  active: boolean
  /** successful turns recorded in the current conversation */
  turns: number
  /** which harness the conversation belongs to (resume only applies within it) */
  harness?: string
}

/** The agent's raw resumable session id, surfaced for manual view/edit in Settings. */
export interface AgentSessionInfo {
  sessionId: string | null
  turns: number
  harness?: string
}

export interface HarnessCapabilities {
  effortLevels: readonly AgentEffort[]
  accessLevels: readonly AgentAccess[]
  ask: boolean
  loadout: boolean
  /** Custom model-gateway wire contract this harness can consume in Studio. */
  gateway: 'anthropic' | 'responses' | 'none'
}

/** Whether the selected agent harness is installed, invokable, and configurable. */
export interface HarnessStatus {
  id: string
  label: string
  /** the binary/command probed (e.g. 'claude') */
  bin: string
  ok: boolean
  version?: string
  /** human message — install / PATH guidance when not ok */
  message: string
  /** known harnesses for the selector (locked to one for now) */
  options: { id: string; label: string }[]
  /** an environment/CLI override owns the selection, so the GUI cannot change it */
  locked: boolean
  source: 'environment' | 'domain' | 'default'
  capabilities: HarnessCapabilities
}

/** One MCP server the harness loaded, with its live connection status. */
export interface McpServerInfo {
  name: string
  /** harness-reported status: 'connected' | 'needs-auth' | 'failed' | 'pending' | … */
  status: string
}

/** One skill, reconciled between what is installed on disk and what the harness
 *  actually LOADED for this domain's cwd. `loaded:false` ⇒ installed but inactive
 *  here (e.g. a disabled plugin or a cwd-scoped skill) — the key diagnostic. */
export interface LoadoutSkill {
  /** the slash-command the harness invokes it by — e.g. 'astrale-domain' or 'vercel:nextjs' */
  command: string
  /** display name from SKILL.md frontmatter (falls back to `command`) */
  name: string
  description?: string
  /** where it lives on disk */
  source: 'project' | 'user' | 'plugin'
  /** the providing plugin, when source==='plugin' */
  plugin?: string
  /** present in the harness's loaded slash-commands for this cwd */
  loaded: boolean
  /** absolute path to the skill's SKILL.md (so the UI can show its content) */
  path?: string
}

/** What the harness ACTUALLY loaded for a domain's cwd — read from the `system/init`
 *  event of a headless `claude` probe (the harness-authoritative source), then
 *  reconciled against on-disk skills. The studio's read-only window into its agent. */
export interface HarnessLoadout {
  /** the probe ran and returned an init event */
  ok: boolean
  /** reason when !ok (binary missing / probe timed out / no init event) */
  detail?: string
  /** Model the harness resolves before Studio applies its optional override. */
  nativeModel?: string
  model?: string
  /** Where the effective model came from. */
  modelSource?: 'studio' | 'config' | 'default' | 'runtime'
  /** Models the harness currently advertises for easy selection. */
  models?: HarnessModelOption[]
  permissionMode?: string
  /** how the harness is authed: 'none' | 'ANTHROPIC_API_KEY' | … */
  apiKeySource?: string
  /** the cwd the harness was probed in (the domain root) */
  cwd?: string
  /** built-in tool names loaded (Read, Edit, Bash, …) */
  tools: string[]
  mcpServers: McpServerInfo[]
  skills: LoadoutSkill[]
  /** subagent types available to the harness (incl. plugin-provided) */
  agents: string[]
  /** count of loaded slash-commands that are built-in/harness commands, not skills */
  builtinCommandCount: number
  /** epoch ms when probed */
  probedAt: number
  /** Claude exposes a live init event; Codex exposes configured/installed state. */
  source?: 'runtime' | 'configured'
}

export interface HarnessModelOption {
  /** Stable model slug passed to the harness, e.g. `gpt-5.6-sol`. */
  id: string
  /** Human-friendly catalog label. */
  label: string
  description?: string
  /** The harness catalog's built-in default when no config layer overrides it. */
  isDefault?: boolean
}

/** Domain-attributable agent spend — accumulated from this studio's own runs on
 *  this domain (NOT machine-wide). Stored at `.domain-studio/usage.json`. */
export interface DomainUsage {
  /** runs that reported usage (succeeded or not — a failed turn still costs) */
  runs: number
  /** cumulative tokens (input + output + cache) across those runs */
  tokens: number
  /** cumulative USD across those runs */
  costUsd: number
  lastRunAt?: string
  lastTokens?: number
  lastCostUsd?: number
}

/** Snapshot returned by GET /agent — drives the activity drawer. */
export interface AgentRunSnapshot {
  harness: string
  available: boolean
  /** the active or most-recent run for this domain (null if none yet) */
  run: AgentRun | null
  /** the resumable conversation behind the runs (turns, whether one is live) */
  conversation: ConversationInfo
}

// ─────────────────────────── SSE events ───────────────────────────

export type StudioEvent =
  | { type: 'schema-diff'; domainId: string; schemaHash: string }
  | { type: 'anatomy-diff'; domainId: string }
  | { type: 'comments'; domainId: string }
  | { type: 'compile-error'; domainId: string; message: string }
  | { type: 'resolving'; domainId: string }
  | { type: 'agent-run'; domainId: string; run: AgentRun }
  | { type: 'agent-event'; domainId: string; runId: string; event: AgentEvent }
  | { type: 'hello'; domains: string[] }
  | { type: 'workspace'; domains: string[] }

// ─────────────────────────── Render helpers (client) ───────────────────────────

// ─────────────────────────── Graph layout ───────────────────────────

export interface NodePosition {
  x: number
  y: number
  /** persisted size — only expanded module containers carry one. */
  w?: number
  h?: number
}
export interface LayoutState {
  schemaHash?: string
  positions: Record<string, NodePosition>
}

/** Persisted per-domain canvas visibility — the manual hide-set, inherited-edge category toggle,
 *  and materialized interfaces. Sibling of LayoutState: layout owns node POSITIONS, this owns
 *  what's SHOWN. */
export interface VisibilityState {
  /** refs hidden on the canvas: `class.X` | `edge.X` | `domain.<origin>` (interfaces use
   *  `materializedInterfaces`, not this set — see below) */
  hidden: Record<string, true>
  showInheritedEdges: boolean
  /** Local interfaces MATERIALIZED as canvas NODES (default = badge). Keyed by BARE interface
   *  name (e.g. `Fulfillable`) — a set distinct from `hidden`, so no ref namespace collision. */
  materializedInterfaces: Record<string, true>
}

export type TypeDescriptor =
  | { kind: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'unknown'; optional: boolean }
  | { kind: 'enum'; values: (string | number | boolean | null)[]; optional: boolean }
  | { kind: 'array'; items: TypeDescriptor; optional: boolean }
  | {
      kind: 'object'
      fields: Record<string, TypeDescriptor>
      required: string[]
      optional: boolean
    }
  | { kind: 'ref'; target: string; refKind: 'node' | 'data'; optional: boolean }

// ─────────────────────────── Studio settings (power-user overrides) ───────────────────────────

/** Per-domain overrides for values the studio otherwise hard-codes. Stored at
 *  `.domain-studio/settings.json`; missing keys fall back to defaults. */
export interface StudioSettings {
  /** Harness-native reasoning effort (default 'high') */
  agentEffort: AgentEffort
  /** workspace = sandboxed edits; full = unrestricted local automation */
  agentAccess: AgentAccess
  /** Optional model override, independently remembered for each harness id. */
  agentModels: Record<string, string>
  /** folder under the domain root scanned for integrations (default 'integrations') */
  integrationsDir: string
  /** schema/core extraction subprocess timeout in ms (default 20000) */
  introspectTimeoutMs: number
  /** how often the per-domain instance status refreshes, ms (default 30000) */
  instancePollMs: number
  /** how often the studio re-checks for stale schema / updates, ms (default 600000) */
  updatesPollMs: number
  /** timeout when probing a live view URL from the instance, ms (default 8000) */
  viewProbeTimeoutMs: number
}

// ─────────────────── Harness model gateway (custom LLM endpoint) ───────────────────

/**
 * Point the agent harness (Claude Code) at a custom Anthropic-compatible model
 * gateway — e.g. an Astrale `ai-gateway` model node — instead of its built-in
 * auth. The values become env on the SPAWNED harness child only
 * (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL): the studio
 * never writes them to your shell, your `~/.claude`, or a `claude` you run
 * yourself outside the studio.
 */
/**
 * How the harness gets its bearer token for the gateway. Abstracted so the same
 * gateway works whether the studio runs locally or embedded in the Astrale GUI:
 *   - `mint`  — LOCAL: the studio mints a fresh, short-lived delegation token per
 *               run via `astrale token` (audience derived from the gateway URL).
 *               No secret is stored on disk; auth follows the active CLI identity.
 *   - `token` — MANUAL: a static bearer the user pastes (non-Astrale gateways, or
 *               an explicitly long-lived token).
 *   - `host`  — EMBED: the embedding Astrale GUI supplies the token (via the shell)
 *               and owns mint / refresh / scope; the studio just relays it to the
 *               harness child. The forward-looking path for the iframe deployment.
 */
export type HarnessGatewayAuth =
  | { mode: 'mint'; instance?: string } // instance to mint on; omitted ⇒ the active one
  | { mode: 'token'; token: string }
  | { mode: 'host' }

export interface HarnessGatewayConfig {
  /** master switch — off ⇒ the harness uses its own default auth */
  enabled: boolean
  /** ANTHROPIC_BASE_URL — Claude Code POSTs to `${baseUrl}/v1/messages`. For an
   *  Astrale model node: `https://<gateway-host>/v1/models/<modelNodeId>`. */
  baseUrl: string
  /** ANTHROPIC_MODEL label (cosmetic — the gateway pins the real model by URL). */
  model?: string
  /** how the bearer token is obtained (see HarnessGatewayAuth) */
  auth: HarnessGatewayAuth
}

/** The layered harness-gateway config for a domain: its own per-domain override,
 *  the studio-wide global default, and which one actually takes effect. */
export interface HarnessGatewayState {
  /** per-domain override (`.domain-studio/harness-gateway.json`); null ⇒ inherits global */
  local: HarnessGatewayConfig | null
  /** studio-wide default — applies to every domain that has no local override */
  global: HarnessGatewayConfig | null
  /** the config that actually takes effect (an enabled local ∨ an enabled global), else null */
  effective: HarnessGatewayConfig | null
  /** which layer `effective` came from */
  source: 'domain' | 'global' | 'none'
}

// ─────────────────────────── Update staleness (the header "Update" badge) ───────────────────────────

/** The Astrale CLI's own staleness report — `astrale update --check --json`, run
 *  in the domain root. The CLI owns the detection; the studio only renders it.
 *  Skills are intentionally absent: they ride along with `astrale update`, so a
 *  stale CLI or SDK dep is the only thing worth surfacing. */
export interface StaleReport {
  stale: boolean
  cli: { stale: boolean; managed: boolean; current?: string; latest?: string; channel?: string }
  sdk: {
    stale: boolean
    inProject: boolean
    outdated: { pkg: string; current: string; latest: string }[]
  }
}
