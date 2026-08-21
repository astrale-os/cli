/**
 * Shared schema and introspection contracts.
 *
 * Studio's IR remains a lossy render projection. Canonical reference identity
 * is owned by `../schema/identity`; SDK admission owns schema semantics.
 */

import type { IrDefinitionKey, IrDefinitionRef, IrSchemaRef } from '../schema/identity'

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

/** Portable form of the DSL-owned canonical schema revision. */
export type SchemaRevision = `sha256:${string}`

/** Wire-format check only; SDK admission remains the semantic proof. */
export function isSchemaRevision(value: unknown): value is SchemaRevision {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
}

/**
 * Version of Studio's lossy canonical-schema -> render-IR projection. Persisted
 * baselines must match this value before their IR can be compared.
 */
export const STUDIO_SCHEMA_PROJECTION_VERSION = 1

export type IrCallableAuth = 'anonymous' | 'authenticated' | 'authorized'

export type IrCallableOutput =
  | { mode: 'value'; schema: JsonSchema }
  | { mode: 'stream'; item: JsonSchema }
  | { mode: 'binary' }

export interface IrMethod {
  name: string
  /** Canonical callable input. Legacy projections expose only `params`. */
  input?: JsonSchema
  params: Record<string, JsonSchema>
  /** Names required by canonical `input.required`; absent on legacy Methods. */
  requiredParams?: string[]
  /** Canonical discriminated output. Legacy projections expose only `returns`. */
  output?: IrCallableOutput
  returns: JsonSchema
  static: boolean
  inheritance: MethodInheritance
  description?: string
  auth?: IrCallableAuth
  policy?: unknown
}

/** Standalone Domain Function projected into the Studio's callable vocabulary. */
export interface IrFunction {
  name: string
  input: JsonSchema
  params: Record<string, JsonSchema>
  /** Names required by canonical `input.required`. */
  requiredParams?: string[]
  output: IrCallableOutput
  returns: JsonSchema
  /** Standalone Functions have no receiver; these legacy-compatible fields let
   * existing callable renderers consume them alongside static Methods. */
  static: true
  inheritance: 'default'
  description?: string
  auth?: IrCallableAuth
  policy?: unknown
}

export interface IrInterface {
  type: 'interface'
  name: string
  /** Canonical declaration owner/family; absent on legacy projections. */
  origin?: string
  family?: 'node' | 'edge' | 'both'
  ref?: IrSchemaRef
  extends?: string[]
  extendsRefs?: IrSchemaRef[]
  properties: Record<string, JsonSchema>
  /** Canonical `properties.required`; absence, unlike null, encodes optionality. */
  required?: string[]
  methods: Record<string, IrMethod>
  endpoints?: IrEndpoint[]
  orientation?: 'directed' | 'undirected'
  constraints?: { noSelf?: true; acyclic?: true }
  description?: string
  propertyMetadata?: Record<string, unknown>
  /** Canonical data declaration; `mediaType` is required and extensions stay lossless. */
  data?: { mediaType: string; [key: string]: unknown }
}

export interface IrEndpoint {
  name: string
  types: string[]
  /** Exact accepted Definition coordinates. `types` remains for existing UI consumers. */
  refs?: IrSchemaRef[]
  /** declared multiplicity for this end; max:null = unbounded ("many"). Absent ⇒ unconstrained. */
  cardinality?: { min: number; max: number | null }
}

export interface IrClass {
  type: 'node' | 'edge'
  name: string
  /** Canonical declaration owner/ref; absent on legacy projections. */
  origin?: string
  ref?: IrSchemaRef
  implements?: string[]
  implementsRefs?: IrSchemaRef[]
  /** edges only: the two (source,target) endpoints with role names + allowed types */
  endpoints?: IrEndpoint[]
  orientation?: 'directed' | 'undirected'
  constraints?: { noSelf?: true; acyclic?: true }
  properties: Record<string, JsonSchema>
  /** Canonical `properties.required`; absence, unlike null, encodes optionality. */
  required?: string[]
  methods: Record<string, IrMethod>
  /** class-level icon: raw (lucide-style) SVG markup, `stroke="currentColor"` */
  icon?: string
  description?: string
  propertyMetadata?: Record<string, unknown>
  /** Canonical data declaration; `mediaType` is required and extensions stay lossless. */
  data?: { mediaType: string; [key: string]: unknown }
  policies?: Record<string, IrSchemaRef>
}

export interface IrImportDescriptor {
  origin: string
  definition: 'interface' | 'class'
  ref?: IrDefinitionRef
  /** Canonical qualified identity; absent on legacy import descriptors. */
  key?: IrDefinitionKey
}

export type IrViewTarget = { kind: 'domain' } | { kind: 'definition'; definitions: IrSchemaRef[] }

export interface IrView {
  name: string
  target: IrViewTarget
  auth: 'required' | 'optional' | 'public'
  description?: string
}

export interface SchemaIR {
  version: string
  domain: string
  /** Canonical document format; absent on legacy projections. */
  format?: 'astrale.dsl'
  types: Record<string, JsonSchema>
  interfaces: Record<string, IrInterface>
  classes: Record<string, IrClass>
  imports: Record<string, IrImportDescriptor>
  /**
   * Canonical authoritative import index, keyed by `origin:kind.name`.
   * `imports` remains the unambiguous short-name compatibility index.
   */
  importsByKey?: Record<IrDefinitionKey, IrImportDescriptor>
  /** Exact imported Interface bodies under the same collision-free identity. */
  importedInterfacesByKey?: Record<IrDefinitionKey, IrInterface>
  /** Canonical V1 members absent from the legacy serializer projection. */
  functions: Record<string, IrFunction>
  views?: Record<string, IrView>
  policies?: Record<string, unknown>
  dependencies?: Array<{ origin: string; revision: string }>
  /** Exact canonical genesis declaration; absent on legacy projections. */
  core?: unknown
}

export interface HandlerLink {
  owner: string
  ownerKind: 'class' | 'interface' | 'function'
  method: string
  static: boolean
  /** the legacy runtime registry or current implementation.ts wiring site */
  wiringFile?: string
  wiringLine?: number
  /** the resolved handler file (followed from the `execute` import) */
  handlerFile?: string
  handlerLine?: number
  /** kernel ops detected in the handler (::update, ::link, createNode, …) */
  kernelCalls?: string[]
  /** declared auth policy on the runtime config; absent ⇒ defaults to 'required'. */
  auth?: 'public' | 'optional' | 'required'
  /** Canonical V1 callable auth, when the handler comes from implementation.ts. */
  callableAuth?: IrCallableAuth
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
  code: 'COMPILE_ERROR' | 'EDGE_PROP_TYPE_MISSING'
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
  /** UI/cache identity only. This is not the DSL schema revision. */
  renderFingerprint: string
  schemaMode: 'canonical-admitted' | 'canonical-preview' | 'legacy' | 'unavailable'
  /** DSL-owned revision, present only after cohort SDK admission. */
  schemaRevision?: SchemaRevision
  extractedBy: 'runtime-bun' | 'static-tsmorph-fallback'
  depsInstalled: boolean
  ir: SchemaIR | null
  /**
   * Portable canonical V1 document emitted by the domain. `schemaMode` records
   * whether the cohort SDK admitted it or Studio is rendering it as a structural
   * preview. Kept separate from the lossy render IR; absent for legacy domains.
   */
  schemaRoot?: unknown
  overlay: SchemaOverlay
  /**
   * Unambiguous short-name aliases for imported Interface bodies, retained for
   * legacy renderers. Canonical consumers use `ir.importedInterfacesByKey`, whose
   * `origin:interface.Name` keys cannot collide. Empty when deps aren't installed.
   */
  importedInterfaces?: Record<string, IrInterface>
  /** present when the runtime import failed to compile (render state, not a crash) */
  error?: BundleError | null
  extractedAt: string
}

export interface DomainOverview {
  origin: string
  /** Active SDK composition entry; `domain.ts` is retained for legacy projects. */
  compositionFile?: 'implementation.ts' | 'domain.ts'
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

export interface ViewTargetResult {
  status: 'available' | 'unavailable'
  items: ViewTargetCandidate[]
  selected: ViewTargetCandidate | null
  stale: RememberedViewTarget | null
  truncated: boolean
  reason?: string
}

/** Full launch context shown before Studio asks `astrale view` to resolve and open the View. */
export interface ViewRuntime {
  slug: string
  instance: string | null
  targetRequired: boolean
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

/** One materialized node instance in a domain's core graph. */
export interface StudioCoreNode {
  /** canonical CoreRef identity, e.g. `/:big-shop.example.dev:core.acme` */
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
  /** source Core path, owning Domain path, or a legacy meta-node endpoint */
  from: string
  /** target Core path, owning Domain path, or a legacy meta-node endpoint */
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

/** Client-side rendering description derived from a JSON value schema. */
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
