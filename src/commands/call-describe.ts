import type { Path } from '@astrale-os/sdk/graph/path'
import type { ResolvedFunction, ResolvedMethod } from '@astrale-os/sdk/schema'

import { ClassKey } from '@astrale-os/sdk/graph/class'
import { bundle, schema } from '@astrale-os/sdk/schema'

import { AstraleError } from '../errors'

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
}

/** Resolve one callable from an admitted installed Domain bundle. */
export function describeCallableFromBundle(
  path: Path,
  input: unknown,
): CallableDescription | undefined {
  if (path.ast.anchor.kind !== 'domain') return undefined
  const last = path.ast.steps.at(-1)
  if (last === undefined) return undefined
  const methodClass =
    last.kind === 'method' && last.dispatch === 'instance' ? ClassKey.ref(last.class) : undefined
  const origin = methodClass?.origin ?? path.ast.anchor.origin
  const domain = schema.resolve(bundle.accept(input).root)
  if (domain.origin !== origin) return undefined

  if (last.kind === 'method') {
    const ownerStep = path.ast.steps.at(-2)
    const ownerName =
      methodClass?.name ??
      (ownerStep?.kind === 'projection' && ownerStep.projection.kind === 'class'
        ? ownerStep.projection.name
        : undefined)
    const owner = ownerName === undefined ? undefined : domain.classes[ownerName]
    if (owner?.kind !== 'node') return undefined
    const isStatic = last.dispatch === 'static'
    const methods = isStatic ? owner.static.methods : owner.methods
    const method = [...methods].find((method) => method.name === last.name)
    if (method !== undefined)
      return Object.freeze({
        path: path.raw,
        origin,
        class: owner.ref.name,
        method: method.name,
        dispatch: last.dispatch,
        ...callableFields(method),
      })
    const opposite = isStatic ? owner.methods : owner.static.methods
    if ([...opposite].some((method) => method.name === last.name)) {
      const classPath = `/:${origin}:class.${owner.ref.name}`
      const corrected = isStatic
        ? `${classPath}::${origin}:class.${owner.ref.name}.method.${last.name}`
        : `${classPath}:${last.name}`
      throw new AstraleError(
        'CALL_DISPATCH_MISMATCH',
        `${owner.ref.name}.${last.name} is ${isStatic ? 'an instance method requiring a receiver' : 'a static method'}.`,
        `Inspect its schema with \`astrale introspect ${corrected}\`.${isStatic ? ' To call it, replace the Class receiver with an observed instance Path.' : ''}`,
      )
    }
    return undefined
  }

  if (last.kind === 'projection' && last.projection.kind === 'function') {
    const callable = domain.functions[last.projection.name]
    if (callable === undefined) return undefined
    return Object.freeze({
      path: path.raw,
      origin,
      function: callable.ref.name,
      ...callableFields(callable),
    })
  }
  return undefined
}

function callableFields(callable: ResolvedFunction | ResolvedMethod): Partial<CallableDescription> {
  return {
    ...(callable.description === undefined ? {} : { description: callable.description }),
    auth: callable.auth,
    input: callable.input,
    output: callable.output,
  }
}
