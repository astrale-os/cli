/**
 * Shared schema and introspection contracts.
 *
 * Studio's IR remains a lossy render projection. Canonical reference identity
 * is owned by `../schema/identity`; SDK admission owns schema semantics.
 */

import {
  classRefKey,
  isIrClassRef,
  type IrClassKey,
  type IrClassRef,
  type IrSchemaRef,
} from '../schema/identity'

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

/**
 * The Classes a Node path value schema accepts, as exact Definition coordinates.
 *
 * `x-astrale-path.accepts` is where the V1 DSL records what a `→node` field may point
 * at, and it is the only place a standalone Function names the Classes it works on —
 * a Function declares no receiver, so this is what ties it to the schema.
 */
export function nodePathAccepts(schema: JsonSchema): IrClassRef[] {
  if (!isNodePathSchema(schema)) return []
  const path = schema['x-astrale-path']
  if (typeof path !== 'object' || path === null) return []
  const accepts = (path as { accepts?: unknown }).accepts
  return Array.isArray(accepts) ? accepts.filter(isIrClassRef) : []
}

/**
 * The Classes a callable's input or output names: the Node paths it is or lists, or its
 * fields are or list, as exact Definition coordinates, each once, in declaration order.
 */
export function nodePathsIn(schema: JsonSchema | undefined): IrClassRef[] {
  if (schema === undefined) return []
  // a list of references carries the path schema on its items, not on itself
  const isOrLists = (value: JsonSchema) => [
    ...nodePathAccepts(value),
    ...(value.items === undefined ? [] : nodePathAccepts(value.items)),
  ]
  const refs = [...isOrLists(schema), ...Object.values(schema.properties ?? {}).flatMap(isOrLists)]
  return [...new Map(refs.map((ref) => [classRefKey(ref), ref])).values()]
}

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

/** The value a callable returns, as a schema: none for binary content. */
export function callableOutputSchema({
  output,
}: {
  output: IrCallableOutput
}): JsonSchema | undefined {
  return output.mode === 'value'
    ? output.schema
    : output.mode === 'stream'
      ? output.item
      : undefined
}

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
  abstract: boolean
  /** Local executable declaration; independent of the inherited contract flag. */
  executable: boolean
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

/** A View of the Domain. Every View belongs to its Domain; none is bound to a Class or a node. */
export interface IrView {
  name: string
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
  /** ids of the Query and Mutation definitions the handler reaches, itself or through authored helpers */
  definitions?: string[]
  /** other callables the handler reaches the same way, keyed `Class.method` */
  calls?: string[]
  /** Integration operations the handler reaches the same way, keyed `key.operation` */
  integrations?: string[]
  /** where the reading cannot tell which Integration operations the handler reaches */
  integrationGaps?: SourceGap[]
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

/** A `defineQuery()` / `defineMutation()` declaration in the Domain's sources. */
export interface DefinitionLink {
  kind: 'query' | 'mutation'
  /** the declared id, e.g. `issues.comment.delete` */
  id: string
  /** the binding that exports it, e.g. `deleteComment` */
  name?: string
  file: string
  line: number
  /** the Classes its effects name, in the order of their first effect */
  classes: string[]
  doc?: string
  /** what its `build` does, in the order the reading meets it; absent when it meets nothing */
  effects?: DefinitionEffect[]
  /**
   * a Mutation's preconditions, one per `mutation.expect.*` call its `build` reaches, in the order
   * the reading meets them; absent when it states none
   */
  preconditions?: DefinitionPrecondition[]
  /** where the reading cannot tell what it does; absent when the effects are complete */
  gaps?: SourceGap[]
}

/**
 * What a precondition requires, by the SDK verb that states it (`mutation.expect.<kind>`):
 * `node`, the Node exists, of the Class, its Properties meeting `equals` and `absent`; `edge`, the
 * Edge exists between `source` and `target`, of the Class, with `slug` and those Properties;
 * `none`, no root of `range` matches; `exists`, one does; `count`, their number lies in `bounds`;
 * `unchanged`, they are exactly `ids`, in order; `query` (Query V6, deprecated), `query` answers
 * `equals`.
 */
export type DefinitionPreconditionKind =
  | 'node'
  | 'edge'
  | 'none'
  | 'exists'
  | 'count'
  | 'unchanged'
  | 'query'

/**
 * The SDK's name for one part of a precondition; `props` stands for Properties the reading cannot
 * split into `equals` and `absent`.
 */
export type PreconditionTermName =
  | 'node'
  | 'source'
  | 'target'
  | 'slug'
  | 'equals'
  | 'absent'
  | 'props'
  | 'range'
  | 'bounds'
  | 'ids'
  | 'query'

/**
 * One part of a precondition as the source writes it, whitespace folded to one line. A bare name
 * of a `const` the same file initialises reads as that initialiser.
 */
export interface PreconditionTerm {
  term: PreconditionTermName
  text: string
}

/**
 * A precondition a Mutation's `build` states: the Kernel refuses the Mutation when it does not
 * hold. The Studio reads it from the source and checks none of it.
 */
export interface DefinitionPrecondition {
  kind: DefinitionPreconditionKind
  /** the Classes it requires something of, as the IR keys them; empty when the reading cannot tell */
  classes: string[]
  /** the name a refusal carries as `failure.precondition`, when the source gives one */
  name?: string
  /** its parts, in the order the SDK takes them; the Class is in `classes` */
  terms: PreconditionTerm[]
  file: string
  line: number
  /**
   * the conditions and loops it is stated under in the function that states it, outermost
   * first; absent when that function states it on every path
   */
  under?: PreconditionCondition[]
  /** why the reading cannot tell all of it (its Classes, a part or its name); absent when it can */
  gap?: string
}

/**
 * One condition or loop a precondition is stated under, as the source writes it: required only
 * `when` `source` holds (`if`, `?:`, `&&`, `case`, a guard that leaves before it otherwise), only
 * `unless` it holds (`else`, `||`, a guard that leaves before it when it holds), once for `each`
 * pass of a loop over `source` (`for`, `while`, an array's `forEach`, `map`…), or only when the
 * `try` it is `caught` from throws (`source` is that `try`).
 */
export interface PreconditionCondition {
  kind: 'when' | 'unless' | 'each' | 'caught'
  /** folded to one line: `input.force`, `input.previousTopics`, `nextName === undefined` */
  source: string
  line: number
}

/**
 * What a definition does to a Class: a Mutation writes it (`create`, `update`, `delete`,
 * `transition`) or requires something of it (`expect`); a Query reads it (`read`).
 */
export type DefinitionEffectKind = 'create' | 'update' | 'delete' | 'transition' | 'expect' | 'read'

/** One thing a definition does to one Class, where its source says so. */
export interface DefinitionEffect {
  kind: DefinitionEffectKind
  /** the local Class name or the exact imported key, as the IR keys them */
  class: string
  /**
   * what the source calls: a builder verb (`createEdge`, `expect.count`, `expect.query`), a read
   * (`where`, `via`, `union`, `is`, `Query.expand`), or the name of a relation it follows
   */
  verb: string
  file: string
  line: number
  /** a transition's state Property */
  property?: string
  /** a transition's coordinates, when the source writes them as literals */
  from?: string
  event?: string
  /** the state the Class's state machine moves to from `from` on `event` */
  to?: string
  /** a read's place: where the Query starts, or what it walks through or reaches */
  role?: 'root' | 'traverse'
}

/** A place the source reading cannot follow, in plain words. */
export interface SourceGap {
  file: string
  line: number
  reason: string
}

/** What another attempt of an Integration operation may do, as `defineIntegration.operation` declares it. */
export type IntegrationReplay = 'safe' | 'keyed' | 'unsafe'

export interface IntegrationOperationLink {
  name: string
  /** the decisions the declaration can take; empty when the reading cannot tell */
  replay: IntegrationReplay[]
  line?: number
}

/** An Integration the Domain's runtime declares, under the key its handlers reach it by. */
export interface IntegrationLink {
  /** `context.integrations.<key>` */
  key: string
  /** the `defineIntegration` id, e.g. `admin.machine-lifecycle` */
  id?: string
  /** the binding that exports the declaration */
  name?: string
  file?: string
  line?: number
  doc?: string
  /** absent when the declaration could not be read */
  operations?: IntegrationOperationLink[]
}

export interface SchemaOverlay {
  handlerLinks: HandlerLink[]
  definitions: DefinitionLink[]
  integrations: IntegrationLink[]
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
  /**
   * The canonical V1 documents of every Schema `schemaRoot` depends on, as the DSL Bundle the
   * installed SDK admitted carries them: with `schemaRoot`, the exact Bundle a rule reader reads.
   * Present only for an admitted root whose extractor reports it.
   */
  schemaClosure?: unknown[]
  overlay: SchemaOverlay
  /** present when the runtime import failed to compile (render state, not a crash) */
  error?: BundleError | null
  extractedAt: string
}

export interface DomainOverview {
  origin: string
  /** Active SDK Domain definition entry relative to the project root. */
  domainFile?: string
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
  file?: string
  description?: string
}

/** Full launch context shown before Studio asks `astrale view` to resolve and open the View. */
export interface ViewRuntime {
  slug: string
  /** Opaque, short-lived handle for the exact instance shown below. */
  preparationId: string
  instance: string | null
}

export type ViewSessionResult =
  | {
      status: 'ready'
      sessionId: string
      pageUrl: string
      viewUrl: string
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

/** One Node a Dataset holds. */
export interface StudioCoreNode {
  /** canonical CoreRef identity, e.g. `/:big-shop.example.dev:core.acme` */
  path: string
  /** the IR class this node instantiates (keys into StudioSchemaBundle.ir.classes) */
  className: string
  /** the node's property values, keyed by (possibly owner-qualified) property name */
  data: Record<string, unknown>
}

/** One Edge a Dataset holds, wiring two of its Nodes, or a Node and the owning Domain. */
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

/** One demo Dataset declared under the project's test resources, projected like Core data. */
export interface StudioDataset {
  status: 'ready'
  /** module coordinate exactly as written in astrale.config.ts */
  path: string
  id: string
  title?: string
  description?: string
  /** the Schema origin the Dataset was admitted against */
  origin: string
  /** the DSL revision the Dataset was admitted against */
  revision: string
  /** false when the current schema bundle carries another revision (stale until re-extracted) */
  schemaMatch: boolean
  /** Canonical Schema reference key → explicitly associated Dataset Node id. */
  references: Record<string, string>
  /** `path` is the Dataset Node id; `className` is the local Class name or the exact imported key */
  nodes: StudioCoreNode[]
  edges: StudioCoreEdge[]
  /** named entry points, each resolved to one or more Node ids */
  variables: Record<string, string[]>
}

export interface StudioDatasetFailure {
  status: 'failed'
  path: string
  error: { message: string }
}

/** Every Dataset the project references, extracted on demand and never deployed. */
export interface StudioDatasets {
  domainId: string
  datasets: (StudioDataset | StudioDatasetFailure)[]
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
