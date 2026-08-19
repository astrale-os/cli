import type { Path } from '@astrale-os/sdk/graph/path'

import { AstraleError } from '../errors'

type JsonRecord = Record<string, unknown>

export interface CallableDescription {
  readonly path: string
  readonly origin: string
  readonly method?: string
  readonly function?: string
  readonly class?: string
  readonly dispatch?: 'static' | 'instance'
  readonly description?: string
  readonly auth?: unknown
  readonly input?: unknown
  readonly output?: unknown
  readonly candidates?: readonly CallableDescription[]
}

/** Resolve one callable's input/output from an installed Domain schema document. */
export function describeCallableFromSchema(
  path: Path,
  schema: unknown,
): CallableDescription | undefined {
  if (path.ast.anchor.kind !== 'domain') return undefined
  const origin = path.ast.anchor.origin
  const last = path.ast.steps.at(-1)
  const document = asRecord(schema)
  if (document === undefined || last === undefined) return undefined

  if (last.kind === 'method') {
    const owner = path.ast.steps.at(-2)
    if (
      owner?.kind === 'projection' &&
      (owner.projection.kind === 'class' || owner.projection.kind === 'interface')
    ) {
      const bag = asRecord(
        owner.projection.kind === 'class' ? document.classes : document.interfaces,
      )
      const definition = asRecord(bag?.[owner.projection.name])
      const method = asRecord(asRecord(definition?.methods)?.[last.name])
      if (method !== undefined) {
        return Object.freeze({
          path: path.raw,
          origin,
          class: owner.projection.name,
          method: last.name,
          dispatch: last.dispatch,
          ...callableFields(method),
        })
      }
    }
    const matches = findNamedMethods(document, origin, path.raw, last.name, last.dispatch)
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      return Object.freeze({
        path: path.raw,
        origin,
        method: last.name,
        dispatch: last.dispatch,
        candidates: Object.freeze(matches),
      })
    }
    return undefined
  }

  if (last.kind === 'projection' && last.projection.kind === 'function') {
    const fn = asRecord(asRecord(document.functions)?.[last.projection.name])
    if (fn === undefined) return undefined
    return Object.freeze({
      path: path.raw,
      origin,
      function: last.projection.name,
      ...callableFields(fn),
    })
  }
  return undefined
}

export function missingCallableDescription(path: string): AstraleError {
  return new AstraleError(
    'CALL_DESCRIBE_UNAVAILABLE',
    `No callable schema is installed for ${path}.`,
    'Use a Domain-rooted Path such as /:host.astrale.ai:class.Manager:createInstance. Method Paths are not Function nodes.',
  )
}

function findNamedMethods(
  schema: JsonRecord,
  origin: string,
  path: string,
  method: string,
  dispatch: 'static' | 'instance',
): CallableDescription[] {
  const matches: CallableDescription[] = []
  for (const bag of [schema.classes, schema.interfaces]) {
    const definitions = asRecord(bag)
    if (definitions === undefined) continue
    for (const [className, definition] of Object.entries(definitions)) {
      const methodDef = asRecord(asRecord(asRecord(definition)?.methods)?.[method])
      if (methodDef === undefined) continue
      matches.push(
        Object.freeze({
          path,
          origin,
          class: className,
          method,
          dispatch,
          ...callableFields(methodDef),
        }),
      )
    }
  }
  return matches
}

function callableFields(value: JsonRecord): Partial<CallableDescription> {
  return {
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(value.auth === undefined ? {} : { auth: value.auth }),
    ...(value.input === undefined ? {} : { input: value.input }),
    ...(value.output === undefined ? {} : { output: value.output }),
  }
}

function asRecord(input: unknown): JsonRecord | undefined {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as JsonRecord)
    : undefined
}
