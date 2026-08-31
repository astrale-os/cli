/**
 * Shared schema and introspection contracts.
 *
 * Studio's IR remains a lossy render projection. Canonical reference identity
 * is owned by `../schema/identity`; SDK admission owns schema semantics.
 */

import type { IrClassKey, IrClassRef, IrSchemaRef } from '../schema/identity'

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
  $ref?: string
  [k: string]: unknown
}

const NODE_PATH_SCHEMA_ID = 'https://schemas.astrale.ai/graph/1/node-path'

/** Structural form emitted by the V1 DSL for a graph Node path. */
export function isNodePathSchema(schema: JsonSchema): boolean {
  return schema.$ref === NODE_PATH_SCHEMA_ID && Object.hasOwn(schema, 'x-astrale-path')
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
export const STUDIO_SCHEMA_PROJECTION_VERSION = 4

export type IrCallableAuth = 'anonymous' | 'authenticated' | 'authorized'

export type IrCallableOutput =
  | { mode: 'value'; schema: JsonSchema }
  | { mode: 'stream'; item: JsonSchema }
  | { mode: 'binary' }

export interface IrCallable {
  name: string
  input: JsonSchema
  output: IrCallableOutput
  description?: string
  auth?: IrCallableAuth
  policy?: unknown
}

export interface IrMethod extends IrCallable {
  static: boolean
  inheritance: MethodInheritance
}

/** Standalone DSL callable projected without inventing a receiver. */
export interface IrFunction extends IrCallable {}

export interface IrEndpoint {
  name: string
  types: string[]
  /** Exact accepted Definition coordinates. `types` is the local display projection. */
  refs?: IrSchemaRef[]
  /** declared multiplicity for this end; max:null = unbounded ("many"). Absent ⇒ unconstrained. */
  cardinality?: { min: number; max: number | null }
}

export interface IrClass {
  type: 'node' | 'edge'
  name: string
  origin: string
  ref: IrClassRef
  extends?: string[]
  extendsRefs?: IrClassRef[]
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
  ref: IrClassRef
  key: IrClassKey
}

export type IrViewTarget = { kind: 'domain' } | { kind: 'definition'; definitions: IrSchemaRef[] }

export interface IrView {
  name: string
  target: IrViewTarget
  description?: string
}

export interface SchemaIR {
  format: 'astrale.dsl'
  version: 'v1'
  domain: string
  classes: Record<string, IrClass>
  importsByKey: Record<IrClassKey, IrImportDescriptor>
  importedClassesByKey: Record<IrClassKey, IrClass>
  functions: Record<string, IrFunction>
  views: Record<string, IrView>
  policies: Record<string, unknown>
  dependencies: Array<{ origin: string; revision: string }>
  core: unknown
}

export interface HandlerLink {
  owner: string
  ownerKind: 'class' | 'function'
  kind: 'action' | 'workflow'
  method: string
  static: boolean
  /** The Runtime registry or one modular Action/Workflow file. */
  wiringFile?: string
  wiringLine?: number
  /** the resolved handler file (followed from the `execute` import) */
  handlerFile?: string
  handlerLine?: number
  /** kernel ops detected in the handler (::update, ::link, createNode, …) */
  kernelCalls?: string[]
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

export interface SchemaOverlay {
  handlerLinks: HandlerLink[]
  /** Keyed by Class, Property, Method, Function, Policy, View, or Core anchor. */
  sourceSpans: Record<string, SourceSpan>
}

export interface BundleError {
  message: string
  file?: string
}

export interface StudioSchemaBundle {
  domainId: string
  /** UI/cache identity only. This is not the DSL schema revision. */
  renderFingerprint: string
  schemaMode: 'canonical-admitted' | 'canonical-preview' | 'unavailable'
  /** DSL-owned revision, present only after installed SDK admission. */
  schemaRevision?: SchemaRevision
  extractedBy: 'runtime-bun' | 'static-tsmorph-fallback'
  depsInstalled: boolean
  ir: SchemaIR | null
  /**
   * Portable canonical V1 document emitted by the domain. `schemaMode` records
   * whether the installed SDK admitted it or Studio is rendering it as a structural
   * preview. Kept separate from the lossy render IR.
   */
  schemaRoot?: unknown
  overlay: SchemaOverlay
  /** present when the runtime import failed to compile (render state, not a crash) */
  error?: BundleError | null
  extractedAt: string
}

export interface DomainOverview {
  origin: string
  /** Active SDK Application entry relative to the project root. */
  applicationFile?: string
  adapter: 'astrale' | 'cloudflare' | 'unknown'
  prodTarget?: string
  devSecrets?: string
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
  /** source Core path or owning Domain path */
  from: string
  /** target Core path or owning Domain path */
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
  | { kind: 'ref'; target: 'node'; optional: boolean }
