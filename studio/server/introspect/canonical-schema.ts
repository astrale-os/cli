/**
 * Pure projection from an SDK-admitted portable DomainSchema into Studio's
 * intentionally lossy render model. The extractor calls the authored Domain's
 * own installed SDK for admission before this module interprets the document.
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
  StudioCore,
} from '../../shared/types'

import { classRefKey, isIrClassRef, schemaRefKey } from '../../shared/schema/identity'
import { isSchemaRevision } from '../../shared/types'

type AnyRecord = Record<string, unknown>

export type CanonicalDomainSchemaV1 = AnyRecord & {
  readonly format: 'astrale.dsl'
  readonly version: 'v1'
  readonly origin: string
}

export interface CanonicalSchemaProjection {
  readonly ir: SchemaIR
}

export type CanonicalSchemaAdmission =
  | {
      readonly status: 'admitted'
      readonly root: CanonicalDomainSchemaV1
      readonly closure: CanonicalDomainSchemaV1[]
      readonly revision: `sha256:${string}`
    }
  | {
      readonly status: 'preview'
      readonly root: CanonicalDomainSchemaV1
      readonly closure: CanonicalDomainSchemaV1[]
      readonly revision: null
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

/** Read the exact retained dependency closure through the authored SDK. */
export function closureFromSdk(
  sdkModule: Record<string, unknown>,
  root: CanonicalDomainSchemaV1,
): CanonicalDomainSchemaV1[] {
  const create = asRecord(sdkModule.bundle)?.create
  if (typeof create !== 'function') return []
  try {
    const candidate = asRecord(Reflect.apply(create, undefined, [root]))
    if (candidate?.root !== root) return []
    return admitClosure(candidate.closure, root) ?? []
  } catch {
    return []
  }
}

/** Re-admit one portable root and prove its revision through the authored SDK. */
export function admitCanonicalSchemaFromSdk(
  sdkModule: Record<string, unknown>,
  candidate: CanonicalDomainSchemaV1,
): CanonicalSchemaAdmission {
  const retainedClosure = closureFromSdk(sdkModule, candidate)
  const schemaApi = asRecord(sdkModule.schema)
  const accept = schemaApi?.accept
  const revision = schemaApi?.revision
  const resolve = schemaApi?.resolve
  if (
    typeof accept !== 'function' ||
    typeof revision !== 'function' ||
    typeof resolve !== 'function'
  ) {
    return { status: 'preview', root: candidate, closure: retainedClosure, revision: null }
  }

  try {
    const revisions = new Map<string, string>()
    for (const dependency of retainedClosure) {
      const value = Reflect.apply(revision, schemaApi, [dependency])
      if (!isSchemaRevision(value)) throw new TypeError('SDK returned an invalid revision.')
      revisions.set(dependency.origin, value)
    }
    const lookup = {
      get(origin: string, expected: string): CanonicalDomainSchemaV1 | undefined {
        const dependency = retainedClosure.find((entry) => entry.origin === origin)
        return dependency && revisions.get(origin) === expected ? dependency : undefined
      },
    }
    const accepted = Reflect.apply(accept, schemaApi, [candidate, lookup])
    if (!isCanonicalDomainSchemaV1(accepted) || accepted.origin !== candidate.origin) {
      throw new TypeError('SDK admission returned another root.')
    }
    const acceptedRevision = Reflect.apply(revision, schemaApi, [accepted])
    if (!isSchemaRevision(acceptedRevision))
      throw new TypeError('SDK returned an invalid revision.')
    const domain = asRecord(Reflect.apply(resolve, schemaApi, [accepted]))
    if (domain?.source !== accepted || domain.origin !== accepted.origin) {
      throw new TypeError('SDK resolution did not retain the admitted root.')
    }
    const closure = closureFromSdk(sdkModule, accepted)
    return { status: 'admitted', root: accepted, closure, revision: acceptedRevision }
  } catch {
    return { status: 'preview', root: candidate, closure: retainedClosure, revision: null }
  }
}

export function projectCanonicalSchema(
  root: CanonicalDomainSchemaV1,
  closure: readonly CanonicalDomainSchemaV1[] = [],
): CanonicalSchemaProjection {
  const origin = root.origin
  const classes = Object.fromEntries(
    entriesOf(root.classes).map(([name, declaration]) => [
      name,
      projectClass(origin, name, declaration),
    ]),
  )
  const functions = Object.fromEntries(
    entriesOf(root.functions).map(([name, declaration]) => [
      name,
      projectFunction(name, declaration),
    ]),
  )
  const views = Object.fromEntries(
    entriesOf(root.views).map(([name, declaration]) => [name, projectView(name, declaration)]),
  )
  const schemas = new Map(
    closure.filter(isCanonicalDomainSchemaV1).map((value) => [value.origin, value]),
  )
  const importsByKey = {} as Record<IrClassKey, IrImportDescriptor>
  const importedClassesByKey = {} as Record<IrClassKey, IrClass>
  const pending = collectClassRefs(root)
  const visited = new Set<string>()

  for (let index = 0; index < pending.length; index += 1) {
    const ref = pending[index]
    if (ref.origin === origin) continue
    const key = classRefKey(ref)
    if (visited.has(key)) continue
    visited.add(key)
    importsByKey[key] = { origin: ref.origin, ref, key }
    const owner = schemas.get(ref.origin)
    const declaration = asRecord(asRecord(owner?.classes)?.[ref.name])
    if (owner === undefined || declaration === null) continue
    importedClassesByKey[key] = projectClass(owner.origin, ref.name, declaration)
    pending.push(...collectClassRefsFromClass(declaration))
  }

  const dependencies = arrayOf(root.dependencies).flatMap((value) => {
    const dependency = asRecord(value)
    return typeof dependency?.origin === 'string' && typeof dependency.revision === 'string'
      ? [{ origin: dependency.origin, revision: dependency.revision }]
      : []
  })

  return {
    ir: {
      format: 'astrale.dsl',
      version: 'v1',
      domain: origin,
      classes,
      importsByKey,
      importedClassesByKey,
      functions,
      views,
      policies: recordCopy(root.policies),
      dependencies,
      core: jsonCopy(root.core),
    },
  }
}

/** Project canonical Core data without importing Application or Runtime modules. */
export function projectCanonicalCore(
  root: CanonicalDomainSchemaV1,
): Pick<StudioCore, 'domain' | 'nodes' | 'edges'> {
  const core = asRecord(root.core) ?? {}
  const nodes = entriesOf(core.nodes).map(([slug, raw]) => {
    const node = asRecord(raw) ?? {}
    const selectedClass = classRef(node.class)
    return {
      path: corePath({ origin: root.origin, name: slug }),
      className: selectedClass?.name ?? '?',
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

function projectClass(origin: string, name: string, value: unknown): IrClass {
  const declaration = asRecord(value) ?? {}
  const kind = declaration.kind === 'edge' ? 'edge' : 'node'
  const extendsRefs = refsOf(declaration.extends)
  const propertyEntries = entriesOf(declaration.properties)
  const properties = Object.fromEntries(
    propertyEntries.map(([propertyName, raw]) => [
      propertyName,
      studioSchema(asRecord(raw)?.schema),
    ]),
  )
  const required = propertyEntries.flatMap(([propertyName, raw]) =>
    asRecord(raw)?.required === true ? [propertyName] : [],
  )
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
    properties,
    required,
    methods: projectMethods(declaration.methods),
    ...(kind === 'edge' ? edgeFields(declaration) : {}),
    ...(typeof declaration.description === 'string'
      ? { description: declaration.description }
      : {}),
    ...(Object.keys(propertyMetadata).length === 0 ? {} : { propertyMetadata }),
    ...(dataDeclaration(declaration.data) ? { data: dataDeclaration(declaration.data) } : {}),
    ...(Object.keys(policies).length === 0 ? {} : { policies }),
  }
}

function projectMethods(value: unknown): Record<string, IrMethod> {
  return Object.fromEntries(
    entriesOf(value).map(([name, raw]) => {
      const declaration = asRecord(raw) ?? {}
      const inheritance =
        declaration.inheritance === 'abstract' || declaration.inheritance === 'sealed'
          ? declaration.inheritance
          : 'default'
      return [
        name,
        {
          ...projectCallable(name, declaration),
          static: declaration.static === true,
          inheritance,
        } satisfies IrMethod,
      ]
    }),
  )
}

function projectFunction(name: string, value: unknown): IrFunction {
  return projectCallable(name, value)
}

function projectCallable(name: string, value: unknown): IrFunction {
  const declaration = asRecord(value) ?? {}
  const input = studioSchema(declaration.input)
  const output = callableOutput(declaration.output)
  const auth = callableAuth(declaration.auth)
  return {
    name,
    input,
    output,
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
  const count = edgeCount(endpoint[cardinality])
  return {
    name: typeof endpoint.role === 'string' ? endpoint.role : '',
    types: refs.map((ref) => ref.name),
    refs,
    ...(count === undefined ? {} : { cardinality: count }),
  }
}

function edgeCount(value: unknown): IrEndpoint['cardinality'] | undefined {
  if (value === '0..*') return { min: 0, max: null }
  if (value === '1..*') return { min: 1, max: null }
  if (value === '0..1') return { min: 0, max: 1 }
  if (value === '1') return { min: 1, max: 1 }
  return undefined
}

function collectClassRefs(root: CanonicalDomainSchemaV1): IrClassRef[] {
  const refs: IrClassRef[] = []
  for (const [, declaration] of entriesOf(root.classes)) {
    refs.push(...collectClassRefsFromClass(declaration))
  }
  for (const [, callable] of entriesOf(root.functions)) collectCallableRefs(callable, refs)
  for (const [, view] of entriesOf(root.views)) {
    refs.push(...refsOf(asRecord(asRecord(view)?.target)?.definitions))
  }
  const core = asRecord(root.core)
  for (const [, node] of entriesOf(core?.nodes)) addClassRef(asRecord(node)?.class, refs)
  for (const edge of arrayOf(core?.edges)) {
    const declaration = asRecord(edge)
    addClassRef(declaration?.class, refs)
  }
  for (const [, policy] of entriesOf(root.policies)) collectPolicyRefs(policy, refs)
  return uniqueClassRefs(refs)
}

function collectClassRefsFromClass(value: unknown): IrClassRef[] {
  const declaration = asRecord(value) ?? {}
  const refs = [...refsOf(declaration.extends)]
  const endpoints = asRecord(declaration.endpoints)
  for (const endpoint of [
    endpoints?.source,
    endpoints?.target,
    ...arrayOf(declaration.endpoints),
  ]) {
    refs.push(...refsOf(asRecord(endpoint)?.accepts))
  }
  for (const [, property] of entriesOf(declaration.properties)) {
    collectPathSchemaRefs(asRecord(property)?.schema, refs)
  }
  for (const [, callable] of entriesOf(declaration.methods)) collectCallableRefs(callable, refs)
  for (const [, policy] of entriesOf(declaration.policies)) collectPolicyRefs(policy, refs)
  return uniqueClassRefs(refs)
}

function collectCallableRefs(value: unknown, refs: IrClassRef[]): void {
  const callable = asRecord(value)
  if (callable === null) return
  collectPathSchemaRefs(callable.input, refs)
  const output = asRecord(callable.output)
  collectPathSchemaRefs(output?.schema ?? output?.item, refs)
  collectPolicyRefs(callable.policy, refs)
}

function collectPathSchemaRefs(value: unknown, refs: IrClassRef[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPathSchemaRefs(item, refs)
    return
  }
  const object = asRecord(value)
  if (object === null) return
  const annotation = asRecord(object['x-astrale-path'])
  refs.push(...refsOf(annotation?.accepts))
  for (const [key, child] of Object.entries(object)) {
    if (key === 'const' || key === 'enum' || key === 'default' || key === 'examples') continue
    collectPathSchemaRefs(child, refs)
  }
}

function collectPolicyRefs(value: unknown, refs: IrClassRef[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPolicyRefs(item, refs)
    return
  }
  const object = asRecord(value)
  if (object === null) return
  addClassRef(object.class, refs)
  for (const child of Object.values(object)) collectPolicyRefs(child, refs)
}

function addClassRef(value: unknown, refs: IrClassRef[]): void {
  const ref = classRef(value)
  if (ref !== null) refs.push(ref)
}

function refsOf(value: unknown): IrClassRef[] {
  return arrayOf(value)
    .map(classRef)
    .filter((ref): ref is IrClassRef => ref !== null)
}

function classRef(value: unknown): IrClassRef | null {
  const ref = definitionRefOf(value)
  return ref !== null && isIrClassRef(ref) ? ref : null
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

function uniqueClassRefs(refs: readonly IrClassRef[]): IrClassRef[] {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = classRefKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
  if (endpoint?.kind === 'domain' && typeof endpoint.origin === 'string') {
    return `/:${endpoint.origin}`
  }
  const ref = definitionRefOf(value)
  return ref?.kind === 'core' ? corePath(ref) : `/:${rootOrigin}`
}

function corePath(ref: Pick<IrSchemaRef, 'origin' | 'name'>): string {
  return `/:${ref.origin}:core.${ref.name}`
}

function admitClosure(
  value: unknown,
  root: CanonicalDomainSchemaV1,
): CanonicalDomainSchemaV1[] | null {
  if (!Array.isArray(value)) return null
  const closure: CanonicalDomainSchemaV1[] = []
  const origins = new Set<string>()
  for (const candidate of value) {
    if (!isCanonicalDomainSchemaV1(candidate) || candidate.origin === root.origin) return null
    if (origins.has(candidate.origin)) return null
    origins.add(candidate.origin)
    closure.push(candidate)
  }
  return closure
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
