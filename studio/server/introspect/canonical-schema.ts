/**
 * Pure projection of the canonical, portable DomainSchema V1 document into the
 * Studio's backward-compatible render IR. This module deliberately imports no
 * Kernel or SDK package: extractor islands must interpret the schema emitted by
 * the domain's own SDK cohort, not a second copy installed beside Studio.
 */
import type {
  IrCallableAuth,
  IrCallableOutput,
  IrClass,
  IrDefinitionKey,
  IrEndpoint,
  IrFunction,
  IrImportDescriptor,
  IrInterface,
  IrMethod,
  IrSchemaRef,
  IrView,
  JsonSchema,
  SchemaIR,
  StudioCore,
} from '../../shared/types'

import { definitionRefKey, isIrDefinitionRef, schemaRefKey } from '../../shared/schema/identity'
import { isSchemaRevision } from '../../shared/types'

type AnyRecord = Record<string, unknown>

export type CanonicalDomainSchemaV1 = AnyRecord & {
  readonly format: 'astrale.dsl'
  readonly version: 'v1'
  readonly origin: string
}

export interface CanonicalSchemaProjection {
  ir: SchemaIR
  importedInterfaces: Record<string, IrInterface>
}

export type CanonicalSchemaAdmission =
  | {
      status: 'admitted'
      root: CanonicalDomainSchemaV1
      closure: CanonicalDomainSchemaV1[]
      revision: `sha256:${string}`
    }
  | {
      status: 'preview'
      root: CanonicalDomainSchemaV1
      closure: CanonicalDomainSchemaV1[]
      revision: null
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

  const candidates = Object.entries(moduleExports)
    .filter((entry): entry is [string, CanonicalDomainSchemaV1] =>
      isCanonicalDomainSchemaV1(entry[1]),
    )
    .sort(([left], [right]) => left.localeCompare(right))
  return candidates[0]?.[1] ?? null
}

/**
 * Read the exact retained dependency closure through the domain's own SDK.
 * Calls are optional and fail closed: an unrecognised/substituted result is
 * discarded rather than trusted as imported-schema evidence.
 */
export function closureFromSdk(
  sdkModule: Record<string, unknown>,
  root: CanonicalDomainSchemaV1,
): CanonicalDomainSchemaV1[] {
  const bundleApi = asRecord(sdkModule.bundle)
  const create = bundleApi?.create
  if (typeof create === 'function') {
    try {
      const candidate = Reflect.apply(create, bundleApi, [root])
      const bundle = asRecord(candidate)
      if (bundle?.root === root) {
        const closure = admitClosure(bundle.closure, root)
        if (closure) return closure
      }
    } catch {
      // A structurally V1-looking export may lack retained SDK admission context.
    }
  }

  const schemaApi = asRecord(sdkModule.schema)
  const resolve = schemaApi?.resolve
  if (typeof resolve === 'function') {
    try {
      const candidate = asRecord(Reflect.apply(resolve, schemaApi, [root]))
      const resolution = asRecord(candidate?.$)
      if (resolution?.schema === root) {
        const closure = admitClosure(resolution.closure, root)
        if (closure) return closure
      }
    } catch {
      // Missing retained context is a valid degradation: local schema still renders.
    }
  }

  return []
}

/**
 * Re-admit a structurally V1-looking export through the Domain's own SDK cohort.
 * Retained Builder context supplies the exact dependency closure. If that proof
 * is unavailable or admission fails, Studio may still render the document as a
 * structural preview, but it must not assign a canonical revision to it.
 */
export function admitCanonicalSchemaFromSdk(
  sdkModule: Record<string, unknown>,
  candidate: CanonicalDomainSchemaV1,
): CanonicalSchemaAdmission {
  const retainedClosure = closureFromSdk(sdkModule, candidate)
  const schemaApi = asRecord(sdkModule.schema)
  const accept = schemaApi?.accept
  const revision = schemaApi?.revision
  if (!schemaApi || typeof accept !== 'function' || typeof revision !== 'function') {
    return { status: 'preview', root: candidate, closure: retainedClosure, revision: null }
  }

  try {
    const revisions = new Map<string, string>()
    for (const dependency of retainedClosure) {
      const value = Reflect.apply(revision, schemaApi, [dependency])
      if (!isSchemaRevision(value)) throw new TypeError('SDK returned an invalid schema revision')
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
      throw new TypeError('SDK admission returned a different schema root')
    }
    const acceptedRevision = Reflect.apply(revision, schemaApi, [accepted])
    if (!isSchemaRevision(acceptedRevision)) {
      throw new TypeError('SDK returned an invalid schema revision')
    }

    // Resolve the newly accepted value once more so its retained closure, rather
    // than Studio's structural candidate, is what feeds exact-ref projection.
    const resolve = schemaApi.resolve
    let closure = retainedClosure
    if (typeof resolve === 'function') {
      const resolved = asRecord(Reflect.apply(resolve, schemaApi, [accepted]))
      const proof = asRecord(resolved?.$)
      if (proof?.schema !== accepted) throw new TypeError('SDK resolution did not retain the root')
      const admitted = admitClosure(proof.closure, accepted)
      if (!admitted) throw new TypeError('SDK resolution returned an invalid dependency closure')
      closure = admitted
    }

    return { status: 'admitted', root: accepted, closure, revision: acceptedRevision }
  } catch {
    return { status: 'preview', root: candidate, closure: retainedClosure, revision: null }
  }
}

/** Add fields required by the current shared contract to a legacy serializer IR. */
export function normalizeLegacySchemaIR(value: unknown): SchemaIR {
  const ir = asRecord(value)
  if (!ir) throw new TypeError('legacy schema IR must be an object')

  const functions: Record<string, IrFunction> = {}
  for (const [name, raw] of entriesOf(ir.functions)) {
    const declaration = asRecord(raw) ?? {}
    const params = schemaRecord(declaration.params)
    const returns = studioSchema(declaration.returns)
    const requiredParams =
      declaration.input === undefined
        ? legacyRequiredParams(params)
        : requiredNames(declaration.input)
    functions[name] = {
      name,
      input: studioSchema(declaration.input ?? objectInputFromParams(params, requiredParams)),
      params,
      requiredParams,
      output: callableOutput(declaration.output, returns),
      returns,
      static: true,
      inheritance: 'default',
      ...(callableAuth(declaration.auth) ? { auth: callableAuth(declaration.auth) } : {}),
      ...(typeof declaration.description === 'string'
        ? { description: declaration.description }
        : {}),
      ...(declaration.policy === undefined ? {} : { policy: jsonCopy(declaration.policy) }),
    }
  }

  return { ...(ir as unknown as SchemaIR), functions }
}

export function projectCanonicalSchema(
  root: CanonicalDomainSchemaV1,
  closure: readonly CanonicalDomainSchemaV1[] = [],
): CanonicalSchemaProjection {
  const origin = root.origin
  const interfaces = Object.fromEntries(
    entriesOf(root.interfaces).map(([name, declaration]) => [
      name,
      projectInterface(origin, name, declaration),
    ]),
  )
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

  const importsByKey: Record<IrDefinitionKey, IrImportDescriptor> = {}
  const importedInterfacesByKey: Record<IrDefinitionKey, IrInterface> = {}
  const schemas = new Map(
    closure.filter(isCanonicalDomainSchemaV1).map((schema) => [schema.origin, schema]),
  )
  const pending = collectDefinitionRefs(root)
  const visited = new Set<string>()

  for (let index = 0; index < pending.length; index++) {
    const ref = pending[index]
    if (!isIrDefinitionRef(ref) || ref.origin === origin) continue
    const key = definitionRefKey(ref)
    if (visited.has(key)) continue
    visited.add(key)

    importsByKey[key] = {
      origin: ref.origin,
      definition: ref.kind,
      ref,
      key,
    }
    if (ref.kind !== 'interface' || key in importedInterfacesByKey) continue

    const owner = schemas.get(ref.origin)
    const declaration = asRecord(asRecord(owner?.interfaces)?.[ref.name])
    if (!owner || !declaration) continue
    const projected = projectInterface(owner.origin, ref.name, declaration)
    importedInterfacesByKey[key] = projected
    pending.push(...collectDefinitionRefsFromDeclaration(declaration))
  }

  // Bare member names are retained solely as an unambiguous compatibility
  // lookup. The canonical Key maps above remain complete when origins or kinds
  // reuse a name, and prevent a traversal-order-dependent "first one wins".
  const nameCounts = new Map<string, number>()
  for (const descriptor of Object.values(importsByKey)) {
    const name = descriptor.ref?.name
    if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  }
  const localNames = new Set([...Object.keys(interfaces), ...Object.keys(classes)])
  const isUnambiguous = (name: string): boolean =>
    nameCounts.get(name) === 1 && !localNames.has(name)
  const imports = Object.fromEntries(
    Object.values(importsByKey).flatMap((descriptor) => {
      const name = descriptor.ref?.name
      return name && isUnambiguous(name) ? [[name, descriptor]] : []
    }),
  )
  const importedInterfaces = Object.fromEntries(
    Object.values(importedInterfacesByKey).flatMap((declaration) =>
      isUnambiguous(declaration.name) ? [[declaration.name, declaration]] : [],
    ),
  )

  const dependencies = arrayOf(root.dependencies)
    .map(asRecord)
    .filter((dependency): dependency is AnyRecord => dependency !== null)
    .flatMap((dependency) =>
      typeof dependency.origin === 'string' && typeof dependency.revision === 'string'
        ? [{ origin: dependency.origin, revision: dependency.revision }]
        : [],
    )

  return {
    ir: {
      format: 'astrale.dsl',
      version: 'v1',
      domain: origin,
      types: schemaRecord(root.types),
      interfaces,
      classes,
      imports,
      importsByKey,
      importedInterfacesByKey,
      functions,
      views,
      policies: recordCopy(root.policies),
      dependencies,
      core: jsonCopy(root.core),
    },
    importedInterfaces,
  }
}

/** Project canonical genesis data without importing the effectful Domain entry. */
export function projectCanonicalCore(
  root: CanonicalDomainSchemaV1,
): Pick<StudioCore, 'domain' | 'nodes' | 'edges'> {
  const core = asRecord(root.core) ?? {}
  const nodes = entriesOf(core.nodes).map(([slug, raw]) => {
    const node = asRecord(raw) ?? {}
    const classRef = schemaRef(node.class)
    return {
      path: corePath({ origin: root.origin, kind: 'core', name: slug }),
      className: classRef?.name ?? '?',
      data: recordCopy(node.properties),
    }
  })
  const edges = arrayOf(core.edges).map((raw) => {
    const edge = asRecord(raw) ?? {}
    const classRef = schemaRef(edge.class)
    return {
      from: coreEndpoint(edge.source, root.origin),
      to: coreEndpoint(edge.target, root.origin),
      edgeName: classRef?.name ?? '?',
      ...(edge.properties === undefined ? {} : { data: recordCopy(edge.properties) }),
    }
  })
  return { domain: root.origin, nodes, edges }
}

function projectInterface(origin: string, name: string, value: unknown): IrInterface {
  const declaration = asRecord(value) ?? {}
  const family = definitionFamily(declaration.family, 'both')
  const extendsRefs = refsOf(declaration.extends, 'interface')
  return {
    type: 'interface',
    name,
    origin,
    family,
    ref: { origin, kind: 'interface', name },
    extends: extendsRefs.map((ref) => ref.name),
    extendsRefs,
    properties: propertySchemas(declaration),
    required: requiredNames(declaration.properties),
    methods: projectMethods(declaration.methods),
    ...(family === 'edge' ? edgeFields(declaration) : {}),
    ...(typeof declaration.description === 'string'
      ? { description: declaration.description }
      : {}),
    ...(asRecord(declaration.propertyMetadata)
      ? { propertyMetadata: recordCopy(declaration.propertyMetadata) }
      : {}),
    ...(dataDeclaration(declaration.data) ? { data: dataDeclaration(declaration.data) } : {}),
  }
}

function projectClass(origin: string, name: string, value: unknown): IrClass {
  const declaration = asRecord(value) ?? {}
  const family = definitionFamily(declaration.family, 'node') === 'edge' ? 'edge' : 'node'
  const implementsRefs = refsOf(declaration.implements, 'interface')
  const policies = Object.fromEntries(
    entriesOf(declaration.policies).flatMap(([policyName, raw]) => {
      const ref = schemaRef(raw)
      return ref ? [[policyName, ref]] : []
    }),
  )
  return {
    type: family,
    name,
    origin,
    ref: { origin, kind: 'class', name },
    implements: implementsRefs.map((ref) => ref.name),
    implementsRefs,
    properties: propertySchemas(declaration),
    required: requiredNames(declaration.properties),
    methods: projectMethods(declaration.methods),
    ...(family === 'edge' ? edgeFields(declaration) : {}),
    ...(typeof declaration.icon === 'string' ? { icon: declaration.icon } : {}),
    ...(typeof declaration.description === 'string'
      ? { description: declaration.description }
      : {}),
    ...(asRecord(declaration.propertyMetadata)
      ? { propertyMetadata: recordCopy(declaration.propertyMetadata) }
      : {}),
    ...(dataDeclaration(declaration.data) ? { data: dataDeclaration(declaration.data) } : {}),
    ...(Object.keys(policies).length > 0 ? { policies } : {}),
  }
}

function projectMethods(value: unknown): Record<string, IrMethod> {
  return Object.fromEntries(
    entriesOf(value).map(([name, declaration]) => {
      const callable = projectCallable(name, declaration)
      const raw = asRecord(declaration) ?? {}
      const inheritance =
        raw.inheritance === 'abstract' ||
        raw.inheritance === 'sealed' ||
        raw.inheritance === 'default'
          ? raw.inheritance
          : 'default'
      return [
        name,
        {
          ...callable,
          static: raw.static === true,
          inheritance,
        } satisfies IrMethod,
      ]
    }),
  )
}

function projectFunction(name: string, declaration: unknown): IrFunction {
  return {
    ...projectCallable(name, declaration),
    static: true,
    inheritance: 'default',
  }
}

function projectCallable(name: string, value: unknown): Omit<IrFunction, 'static' | 'inheritance'> {
  const declaration = asRecord(value) ?? {}
  const input = studioSchema(declaration.input)
  const output = callableOutput(declaration.output, {})
  const auth = callableAuth(declaration.auth)
  return {
    name,
    input,
    params: callableParams(declaration.input),
    requiredParams: requiredNames(declaration.input),
    output,
    returns: outputValue(output),
    ...(typeof declaration.description === 'string'
      ? { description: declaration.description }
      : {}),
    ...(auth ? { auth } : {}),
    ...(declaration.policy === undefined ? {} : { policy: jsonCopy(declaration.policy) }),
  }
}

function projectView(name: string, value: unknown): IrView {
  const declaration = asRecord(value) ?? {}
  const rawTarget = asRecord(declaration.target)
  const target =
    rawTarget?.kind === 'definition'
      ? ({
          kind: 'definition',
          definitions: refsOf(rawTarget.definitions, ['class', 'interface']),
        } as const)
      : ({ kind: 'domain' } as const)
  const auth =
    declaration.auth === 'optional' || declaration.auth === 'public' ? declaration.auth : 'required'
  return {
    name,
    target,
    auth,
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
  const rawConstraints = asRecord(declaration.constraints)
  const constraints = {
    ...(rawConstraints?.noSelf === true ? { noSelf: true as const } : {}),
    ...(rawConstraints?.acyclic === true ? { acyclic: true as const } : {}),
  }
  return { endpoints: projected, orientation, constraints }
}

function projectEndpoint(
  value: unknown,
  countKey: 'outgoing' | 'incoming' | 'incident',
): IrEndpoint {
  const endpoint = asRecord(value) ?? {}
  const refs = refsOf(endpoint.accepts, ['class', 'interface'])
  const cardinality = edgeCount(endpoint[countKey])
  return {
    name: typeof endpoint.role === 'string' ? endpoint.role : '',
    types: refs.map((ref) => ref.name),
    refs,
    ...(cardinality ? { cardinality } : {}),
  }
}

function edgeCount(value: unknown): IrEndpoint['cardinality'] | undefined {
  switch (value) {
    case '0..*':
      return { min: 0, max: null }
    case '1..*':
      return { min: 1, max: null }
    case '0..1':
      return { min: 0, max: 1 }
    case '1':
      return { min: 1, max: 1 }
    default:
      return undefined
  }
}

function propertySchemas(declaration: AnyRecord): Record<string, JsonSchema> {
  const object = asRecord(declaration.properties) ?? {}
  return Object.fromEntries(
    entriesOf(object.properties).map(([name, schema]) => [name, studioSchema(schema)]),
  )
}

function callableParams(input: unknown): Record<string, JsonSchema> {
  const object = asRecord(input)
  if (!object) return {}
  return Object.fromEntries(
    entriesOf(object.properties).map(([name, schema]) => [name, studioSchema(schema)]),
  )
}

function callableOutput(value: unknown, fallback: JsonSchema): IrCallableOutput {
  const output = asRecord(value)
  if (output?.mode === 'stream') return { mode: 'stream', item: studioSchema(output.item) }
  if (output?.mode === 'binary') return { mode: 'binary' }
  if (output?.mode === 'value') return { mode: 'value', schema: studioSchema(output.schema) }
  return { mode: 'value', schema: fallback }
}

function outputValue(output: IrCallableOutput): JsonSchema {
  if (output.mode === 'value') return output.schema
  if (output.mode === 'stream') return output.item
  return {}
}

function callableAuth(value: unknown): IrCallableAuth | undefined {
  return value === 'anonymous' || value === 'authenticated' || value === 'authorized'
    ? value
    : undefined
}

function definitionFamily(value: unknown, fallback: 'node' | 'both'): 'node' | 'edge' | 'both' {
  return value === 'node' || value === 'edge' || value === 'both' ? value : fallback
}

function dataDeclaration(
  value: unknown,
): { mediaType: string; [key: string]: unknown } | undefined {
  const data = asRecord(value)
  return typeof data?.mediaType === 'string'
    ? (jsonCopy(data) as { mediaType: string; [key: string]: unknown })
    : undefined
}

function refsOf(
  value: unknown,
  kinds: IrSchemaRef['kind'] | readonly IrSchemaRef['kind'][],
): IrSchemaRef[] {
  const accepted = new Set(Array.isArray(kinds) ? kinds : [kinds])
  return arrayOf(value)
    .map(schemaRef)
    .filter((ref): ref is IrSchemaRef => ref !== null && accepted.has(ref.kind))
}

function schemaRef(value: unknown): IrSchemaRef | null {
  const ref = asRecord(value)
  if (!ref || typeof ref.origin !== 'string' || typeof ref.name !== 'string') return null
  switch (ref.kind) {
    case 'type':
    case 'interface':
    case 'class':
    case 'function':
    case 'policy':
    case 'view':
    case 'core':
      return { origin: ref.origin, kind: ref.kind, name: ref.name }
    default:
      return null
  }
}

function collectDefinitionRefs(root: CanonicalDomainSchemaV1): IrSchemaRef[] {
  const refs: IrSchemaRef[] = []
  for (const [, declaration] of entriesOf(root.types)) {
    collectPathSchemaRefs(declaration, refs)
  }
  for (const [, declaration] of entriesOf(root.interfaces)) {
    refs.push(...collectDefinitionRefsFromDeclaration(declaration))
  }
  for (const [, declaration] of entriesOf(root.classes)) {
    refs.push(...collectDefinitionRefsFromDeclaration(declaration))
  }
  for (const [, callable] of entriesOf(root.functions)) collectCallableRefs(callable, refs)
  for (const [, view] of entriesOf(root.views)) {
    const target = asRecord(asRecord(view)?.target)
    refs.push(...refsOf(target?.definitions, ['class', 'interface']))
  }
  const core = asRecord(root.core)
  for (const [, node] of entriesOf(core?.nodes)) addRef(asRecord(node)?.class, refs)
  for (const edge of arrayOf(core?.edges)) {
    const declaration = asRecord(edge)
    addRef(declaration?.class, refs)
    addRef(declaration?.source, refs)
    addRef(declaration?.target, refs)
  }
  for (const [, policy] of entriesOf(root.policies)) collectPolicyRefs(policy, refs)
  return uniqueRefs(refs)
}

function collectDefinitionRefsFromDeclaration(value: unknown): IrSchemaRef[] {
  const declaration = asRecord(value) ?? {}
  const refs = [
    ...refsOf(declaration.extends, 'interface'),
    ...refsOf(declaration.implements, 'interface'),
  ]
  collectPathSchemaRefs(declaration.properties, refs)
  const endpoints = asRecord(declaration.endpoints)
  for (const endpoint of [
    endpoints?.source,
    endpoints?.target,
    ...arrayOf(declaration.endpoints),
  ]) {
    refs.push(...refsOf(asRecord(endpoint)?.accepts, ['class', 'interface']))
  }
  for (const [, callable] of entriesOf(declaration.methods)) collectCallableRefs(callable, refs)
  for (const [, policy] of entriesOf(declaration.policies)) addRef(policy, refs)
  return uniqueRefs(refs)
}

function collectCallableRefs(value: unknown, refs: IrSchemaRef[]): void {
  const callable = asRecord(value)
  if (!callable) return
  collectPathSchemaRefs(callable.input, refs)
  const output = asRecord(callable.output)
  collectPathSchemaRefs(output?.schema ?? output?.item, refs)
  collectPolicyRefs(callable.policy, refs)
}

/** Embedded value data is opaque; only the declared x-astrale-path vocabulary carries refs. */
function collectPathSchemaRefs(value: unknown, refs: IrSchemaRef[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPathSchemaRefs(item, refs)
    return
  }
  const object = asRecord(value)
  if (!object) return
  const annotation = asRecord(object['x-astrale-path'])
  if (annotation) refs.push(...refsOf(annotation.accepts, ['class', 'interface']))
  for (const [key, child] of Object.entries(object)) {
    if (key === 'const' || key === 'enum' || key === 'default' || key === 'examples') continue
    collectPathSchemaRefs(child, refs)
  }
}

function collectPolicyRefs(value: unknown, refs: IrSchemaRef[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPolicyRefs(item, refs)
    return
  }
  const object = asRecord(value)
  if (!object) return
  for (const key of ['check', 'class', 'ref']) addRef(object[key], refs)
  for (const key of [
    'allOf',
    'anyOf',
    'exists',
    'where',
    'match',
    'nodes',
    'source',
    'target',
    'object',
  ]) {
    collectPolicyRefs(object[key], refs)
  }
}

function addRef(value: unknown, refs: IrSchemaRef[]): void {
  const ref = schemaRef(value)
  if (ref) refs.push(ref)
}

function uniqueRefs(refs: readonly IrSchemaRef[]): IrSchemaRef[] {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = schemaRefKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function coreEndpoint(value: unknown, rootOrigin: string): string {
  const endpoint = asRecord(value)
  if (endpoint?.kind === 'domain') return `/:${rootOrigin}`
  const ref = schemaRef(value)
  return ref?.kind === 'core' ? corePath(ref) : `/:${rootOrigin}`
}

function corePath(ref: Pick<IrSchemaRef, 'origin' | 'kind' | 'name'>): string {
  return `/:${ref.origin}:core.${ref.name}`
}

function admitClosure(
  value: unknown,
  root: CanonicalDomainSchemaV1,
): CanonicalDomainSchemaV1[] | null {
  if (!Array.isArray(value)) return null
  const closure: CanonicalDomainSchemaV1[] = []
  const origins = new Set<string>()
  for (const schema of value) {
    if (!isCanonicalDomainSchemaV1(schema) || schema.origin === root.origin) return null
    if (origins.has(schema.origin)) return null
    origins.add(schema.origin)
    closure.push(schema)
  }
  return closure
}

function studioSchema(value: unknown): JsonSchema {
  if (value === true) return {}
  if (value === false) return { not: {} }
  return (jsonCopy(asRecord(value) ?? {}) ?? {}) as JsonSchema
}

function schemaRecord(value: unknown): Record<string, JsonSchema> {
  return Object.fromEntries(entriesOf(value).map(([name, schema]) => [name, studioSchema(schema)]))
}

function requiredNames(value: unknown): string[] {
  const object = asRecord(value)
  return arrayOf(object?.required).filter((name): name is string => typeof name === 'string')
}

function legacyRequiredParams(params: Record<string, JsonSchema>): string[] {
  return Object.entries(params).flatMap(([name, schema]) =>
    schemaAllowsNull(schema) ? [] : [name],
  )
}

function schemaAllowsNull(schema: JsonSchema): boolean {
  if (schema.type === 'null') return true
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true
  return [...arrayOf(schema.anyOf), ...arrayOf(schema.oneOf)].some(
    (candidate) => asRecord(candidate)?.type === 'null',
  )
}

function objectInputFromParams(
  params: Record<string, JsonSchema>,
  required: readonly string[],
): JsonSchema {
  return {
    type: 'object',
    properties: params,
    required: [...required],
    additionalProperties: false,
  }
}

function recordCopy(value: unknown): Record<string, any> {
  const record = asRecord(value)
  return record ? (jsonCopy(record) as Record<string, any>) : {}
}

function jsonCopy(value: unknown): any {
  if (Array.isArray(value)) return value.map(jsonCopy)
  const record = asRecord(value)
  if (record)
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, jsonCopy(item)]))
  return value
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
