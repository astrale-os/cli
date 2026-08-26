/**
 * Project the DSL's portable Schema into Studio's deliberately smaller render
 * model. Admission, dependency reachability, and reference resolution remain
 * owned by the Domain's installed DSL.
 */
import type {
  IrCallableAuth,
  IrCallableOutput,
  IrClass,
  IrClassKey,
  IrClassRef,
  IrEndpoint,
  IrFunction,
  IrImportDescriptor,
  IrMethod,
  IrSchemaRef,
  IrView,
  JsonSchema,
  SchemaIR,
  SchemaRevision,
  StudioCore,
} from '../../shared/types'

import { isSchemaRevision } from '../../shared/types'

type AnyRecord = Record<string, unknown>

/** The portable V1 value transported across the extractor process boundary. */
export interface CanonicalDomainSchemaV1 {
  readonly format: 'astrale.dsl'
  readonly version: 'v1'
  readonly origin: string
  readonly dependencies: Readonly<
    Record<string, { readonly origin: string; readonly revision: string }>
  >
  readonly classes: Readonly<Record<string, unknown>>
  readonly functions: Readonly<Record<string, unknown>>
  readonly policies: Readonly<Record<string, unknown>>
  readonly views: Readonly<Record<string, unknown>>
  readonly core: unknown
}

interface ResolvedSchemaDomain {
  readonly source: CanonicalDomainSchemaV1
  readonly revision: unknown
  definition(ref: IrClassRef): { readonly definition: unknown } | undefined
}

/** Runtime facade supplied by the inspected Domain, not by Studio's package. */
export interface SchemaSdk {
  readonly bundle: {
    create(input: any): unknown
    accept(input: any): {
      readonly root: CanonicalDomainSchemaV1
      readonly closure: readonly CanonicalDomainSchemaV1[]
    }
  }
  readonly schema: {
    resolve(input: any): ResolvedSchemaDomain
    compareDependencyMeaning(
      source: CanonicalDomainSchemaV1,
      target: CanonicalDomainSchemaV1,
    ): { readonly footprint: readonly unknown[] }
  }
  readonly ClassKey: {
    is(input: unknown): input is IrClassKey
    ref(input: IrClassKey): IrClassRef
  }
}

/** Smaller facade used when re-admitting an installed Bundle for drift checks. */
export interface SchemaAdmissionSdk {
  readonly bundle: {
    accept(input: any): { readonly root: CanonicalDomainSchemaV1 }
  }
  readonly schema: {
    resolve(input: any): { readonly source: unknown; readonly revision: unknown }
  }
}

export interface CanonicalSchemaExtraction {
  readonly status: 'admitted' | 'preview'
  readonly root: CanonicalDomainSchemaV1
  readonly revision: SchemaRevision | null
  readonly ir: SchemaIR
}

interface ImportProjection {
  importsByKey: Record<IrClassKey, IrImportDescriptor>
  importedClassesByKey: Record<IrClassKey, IrClass>
}

export function isCanonicalDomainSchemaV1(value: unknown): value is CanonicalDomainSchemaV1 {
  const candidate = asRecord(value)
  return (
    candidate?.format === 'astrale.dsl' &&
    candidate.version === 'v1' &&
    typeof candidate.origin === 'string' &&
    candidate.origin.length > 0
  )
}

/** Find a directly exported V1 root, preferring the conventional `schema`. */
export function findCanonicalDomainSchemaExport(
  moduleExports: Record<string, unknown>,
): CanonicalDomainSchemaV1 | null {
  if (isCanonicalDomainSchemaV1(moduleExports.schema)) return moduleExports.schema
  if (isCanonicalDomainSchemaV1(moduleExports.default)) return moduleExports.default
  return (
    Object.entries(moduleExports)
      .filter((entry): entry is [string, CanonicalDomainSchemaV1] =>
        isCanonicalDomainSchemaV1(entry[1]),
      )
      .sort(([left], [right]) => left.localeCompare(right))[0]?.[1] ?? null
  )
}

/**
 * Re-admit the authored Schema as one exact DSL Bundle and resolve its Domain.
 * A V1-shaped value rejected by the installed DSL remains a best-effort local
 * preview while the author is in the middle of an edit.
 */
export function extractCanonicalSchemaFromSdk(
  sdk: SchemaSdk,
  candidate: CanonicalDomainSchemaV1,
): CanonicalSchemaExtraction {
  try {
    const admitted = sdk.bundle.accept(sdk.bundle.create(candidate))
    if (admitted.root.origin !== candidate.origin) {
      throw new TypeError('DSL Bundle admission returned another Schema root.')
    }
    const domain = sdk.schema.resolve(admitted.root)
    if (domain.source !== admitted.root || !isSchemaRevision(domain.revision)) {
      throw new TypeError('DSL resolution did not retain the admitted Schema root.')
    }
    return {
      status: 'admitted',
      root: admitted.root,
      revision: domain.revision,
      ir: projectSchema(admitted.root, projectImports(sdk, domain, admitted.closure)),
    }
  } catch {
    return { status: 'preview', root: candidate, revision: null, ir: projectSchema(candidate) }
  }
}

/** Project canonical Core data without importing Application or Runtime modules. */
export function projectCanonicalCore(
  root: CanonicalDomainSchemaV1,
): Pick<StudioCore, 'domain' | 'nodes' | 'edges'> {
  const core = asRecord(root.core) ?? {}
  const nodes = entriesOf(core.nodes).map(([slug, raw]) => {
    const node = asRecord(raw) ?? {}
    return {
      path: corePath({ origin: root.origin, name: slug }),
      className: classRef(node.class)?.name ?? '?',
      data: recordCopy(node.properties),
    }
  })
  const edges = arrayOf(core.edges).map((raw) => {
    const edge = asRecord(raw) ?? {}
    return {
      from: coreEndpoint(edge.source, root.origin),
      to: coreEndpoint(edge.target, root.origin),
      edgeName: classRef(edge.class)?.name ?? '?',
      ...(edge.properties === undefined ? {} : { data: recordCopy(edge.properties) }),
    }
  })
  return { domain: root.origin, nodes, edges }
}

function projectSchema(root: CanonicalDomainSchemaV1, imports?: ImportProjection): SchemaIR {
  return {
    format: 'astrale.dsl',
    version: 'v1',
    domain: root.origin,
    classes: Object.fromEntries(
      entriesOf(root.classes).map(([name, value]) => [
        name,
        projectClass(root.origin, name, value),
      ]),
    ),
    importsByKey: imports?.importsByKey ?? {},
    importedClassesByKey: imports?.importedClassesByKey ?? {},
    functions: Object.fromEntries(
      entriesOf(root.functions).map(([name, value]) => [name, projectFunction(name, value)]),
    ),
    views: Object.fromEntries(
      entriesOf(root.views).map(([name, value]) => [name, projectView(name, value)]),
    ),
    policies: recordCopy(root.policies),
    dependencies: Object.values(root.dependencies ?? {}).map(({ origin, revision }) => ({
      origin,
      revision,
    })),
    core: jsonCopy(root.core),
  }
}

function projectImports(
  sdk: SchemaSdk,
  domain: ReturnType<SchemaSdk['schema']['resolve']>,
  closure: readonly CanonicalDomainSchemaV1[],
): ImportProjection {
  const importsByKey = {} as Record<IrClassKey, IrImportDescriptor>
  const importedClassesByKey = {} as Record<IrClassKey, IrClass>

  // The DSL computes the exact reachable footprint. Studio no longer recurses
  // through JSON Schemas, policies, Views, and Core declarations to rediscover it.
  for (const dependency of closure) {
    const footprint = sdk.schema.compareDependencyMeaning(domain.source, dependency).footprint
    for (const candidate of footprint) {
      if (!sdk.ClassKey.is(candidate)) continue
      const ref = sdk.ClassKey.ref(candidate)
      const definition = domain.definition(ref)
      if (!definition) continue
      const key = candidate as IrClassKey
      importsByKey[key] = { origin: ref.origin, ref, key }
      importedClassesByKey[key] = projectClass(ref.origin, ref.name, definition.definition)
    }
  }
  return { importsByKey, importedClassesByKey }
}

function projectClass(origin: string, name: string, value: unknown): IrClass {
  const declaration = asRecord(value) ?? {}
  const kind = declaration.kind === 'edge' ? 'edge' : 'node'
  const extendsRefs = refsOf(declaration.extends)
  const propertyEntries = entriesOf(declaration.properties)
  const propertyMetadata = Object.fromEntries(
    propertyEntries.map(([propertyName, raw]) => {
      const member = { ...(asRecord(raw) ?? {}) }
      delete member.schema
      return [propertyName, jsonCopy(member)]
    }),
  )
  const policies = Object.fromEntries(
    entriesOf(declaration.policies).flatMap(([policyName, raw]) => {
      const ref = definitionRefOf(raw)
      return ref ? [[policyName, ref]] : []
    }),
  )
  return {
    type: kind,
    name,
    origin,
    ref: { origin, kind: 'class', name },
    extends: extendsRefs.map((ref) => ref.name),
    extendsRefs,
    properties: Object.fromEntries(
      propertyEntries.map(([propertyName, raw]) => [
        propertyName,
        studioSchema(asRecord(raw)?.schema),
      ]),
    ),
    required: propertyEntries.flatMap(([propertyName, raw]) =>
      asRecord(raw)?.required === true ? [propertyName] : [],
    ),
    methods: Object.fromEntries(
      entriesOf(declaration.methods).map(([methodName, raw]) => [
        methodName,
        projectMethod(methodName, raw),
      ]),
    ),
    ...(kind === 'edge' ? edgeFields(declaration) : {}),
    ...(typeof declaration.icon === 'string' ? { icon: declaration.icon } : {}),
    ...(typeof declaration.description === 'string'
      ? { description: declaration.description }
      : {}),
    ...(Object.keys(propertyMetadata).length === 0 ? {} : { propertyMetadata }),
    ...(dataDeclaration(declaration.data) ? { data: dataDeclaration(declaration.data) } : {}),
    ...(Object.keys(policies).length === 0 ? {} : { policies }),
  }
}

function projectMethod(name: string, value: unknown): IrMethod {
  const declaration = asRecord(value) ?? {}
  return {
    ...projectFunction(name, declaration),
    static: declaration.static === true,
    inheritance:
      declaration.inheritance === 'abstract' || declaration.inheritance === 'sealed'
        ? declaration.inheritance
        : 'default',
  }
}

function projectFunction(name: string, value: unknown): IrFunction {
  const declaration = asRecord(value) ?? {}
  const auth = callableAuth(declaration.auth)
  return {
    name,
    input: studioSchema(declaration.input),
    output: callableOutput(declaration.output),
    ...(typeof declaration.description === 'string'
      ? { description: declaration.description }
      : {}),
    ...(auth === undefined ? {} : { auth }),
    ...(declaration.policy === undefined ? {} : { policy: jsonCopy(declaration.policy) }),
  }
}

function projectView(name: string, value: unknown): IrView {
  const declaration = asRecord(value) ?? {}
  const target = asRecord(declaration.target)
  return {
    name,
    target:
      target?.kind === 'definition'
        ? { kind: 'definition', definitions: refsOf(target.definitions) }
        : { kind: 'domain' },
    ...(typeof declaration.description === 'string'
      ? { description: declaration.description }
      : {}),
  }
}

function edgeFields(
  declaration: AnyRecord,
): Pick<IrClass, 'endpoints' | 'orientation' | 'constraints'> {
  const orientation = declaration.orientation === 'undirected' ? 'undirected' : 'directed'
  const endpoints = asRecord(declaration.endpoints)
  const projected =
    orientation === 'undirected'
      ? arrayOf(declaration.endpoints).map((endpoint) => projectEndpoint(endpoint, 'incident'))
      : [
          projectEndpoint(endpoints?.source, 'outgoing'),
          projectEndpoint(endpoints?.target, 'incoming'),
        ]
  const constraints = asRecord(declaration.constraints)
  return {
    endpoints: projected,
    orientation,
    constraints: {
      ...(constraints?.noSelf === true ? { noSelf: true } : {}),
      ...(constraints?.acyclic === true ? { acyclic: true } : {}),
    },
  }
}

function projectEndpoint(
  value: unknown,
  cardinality: 'outgoing' | 'incoming' | 'incident',
): IrEndpoint {
  const endpoint = asRecord(value) ?? {}
  const refs = refsOf(endpoint.accepts)
  const count = endpoint[cardinality]
  return {
    name: typeof endpoint.role === 'string' ? endpoint.role : '',
    types: refs.map((ref) => ref.name),
    refs,
    ...(count === '0..*' || count === '1..*' || count === '0..1' || count === '1'
      ? { cardinality: edgeCount(count) }
      : {}),
  }
}

function edgeCount(value: '0..*' | '1..*' | '0..1' | '1'): IrEndpoint['cardinality'] {
  if (value === '0..*') return { min: 0, max: null }
  if (value === '1..*') return { min: 1, max: null }
  if (value === '0..1') return { min: 0, max: 1 }
  return { min: 1, max: 1 }
}

function callableOutput(value: unknown): IrCallableOutput {
  const output = asRecord(value)
  if (output?.mode === 'stream') return { mode: 'stream', item: studioSchema(output.item) }
  if (output?.mode === 'binary') return { mode: 'binary' }
  return { mode: 'value', schema: studioSchema(output?.schema) }
}

function callableAuth(value: unknown): IrCallableAuth | undefined {
  return value === 'anonymous' || value === 'authenticated' || value === 'authorized'
    ? value
    : undefined
}

function refsOf(value: unknown): IrClassRef[] {
  return arrayOf(value)
    .map(classRef)
    .filter((ref): ref is IrClassRef => ref !== null)
}

function classRef(value: unknown): IrClassRef | null {
  const ref = definitionRefOf(value)
  return ref?.kind === 'class' ? { origin: ref.origin, kind: 'class', name: ref.name } : null
}

function definitionRefOf(value: unknown): IrSchemaRef | null {
  const ref = asRecord(value)
  if (typeof ref?.origin !== 'string' || typeof ref.name !== 'string') return null
  if (
    ref.kind !== 'class' &&
    ref.kind !== 'function' &&
    ref.kind !== 'policy' &&
    ref.kind !== 'view' &&
    ref.kind !== 'core'
  ) {
    return null
  }
  return { origin: ref.origin, kind: ref.kind, name: ref.name }
}

function dataDeclaration(
  value: unknown,
): { mediaType: string; [key: string]: unknown } | undefined {
  const data = asRecord(value)
  return typeof data?.mediaType === 'string'
    ? (jsonCopy(data) as { mediaType: string; [key: string]: unknown })
    : undefined
}

function coreEndpoint(value: unknown, rootOrigin: string): string {
  const endpoint = asRecord(value)
  if (endpoint?.kind === 'domain') {
    return `/:${typeof endpoint.origin === 'string' ? endpoint.origin : rootOrigin}`
  }
  const ref = definitionRefOf(value)
  return ref?.kind === 'core' ? corePath(ref) : `/:${rootOrigin}`
}

function corePath(ref: Pick<IrSchemaRef, 'origin' | 'name'>): string {
  return `/:${ref.origin}:core.${ref.name}`
}

function studioSchema(value: unknown): JsonSchema {
  if (value === true) return {}
  if (value === false) return { not: {} }
  return (jsonCopy(asRecord(value) ?? {}) ?? {}) as JsonSchema
}

function recordCopy(value: unknown): Record<string, unknown> {
  const record = asRecord(value)
  return record === null ? {} : (jsonCopy(record) as Record<string, unknown>)
}

function jsonCopy(value: unknown): any {
  if (Array.isArray(value)) return value.map(jsonCopy)
  const record = asRecord(value)
  return record === null
    ? value
    : Object.fromEntries(Object.entries(record).map(([key, item]) => [key, jsonCopy(item)]))
}

function entriesOf(value: unknown): [string, unknown][] {
  return Object.entries(asRecord(value) ?? {})
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): AnyRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AnyRecord)
    : null
}
