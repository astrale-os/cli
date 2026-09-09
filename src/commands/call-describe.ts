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
    if (methodClass !== undefined) {
      const owner = domain.classes[methodClass.name]
      if (owner?.kind !== 'node') return undefined
      const method = namedMethod(owner.methods, last.name, 'instance')
      return method === undefined
        ? undefined
        : description(path, origin, methodClass.name, method, 'instance')
    }
    const ownerStep = path.ast.steps.at(-2)
    if (ownerStep?.kind === 'projection' && ownerStep.projection.kind === 'class') {
      const owner = domain.classes[ownerStep.projection.name]
      if (owner?.kind !== 'node') return undefined
      const method = namedMethod(
        last.dispatch === 'static' ? owner.static.methods : owner.methods,
        last.name,
        last.dispatch,
      )
      return method === undefined
        ? undefined
        : description(path, origin, owner.ref.name, method, last.dispatch)
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

export function missingCallableDescription(path: string): AstraleError {
  return new AstraleError(
    'CALL_DESCRIBE_UNAVAILABLE',
    `No callable schema is installed for ${path}.`,
    'Use a Domain-rooted Path such as /:kernel.astrale.ai:class.Identity:whois. Method Paths are not Function nodes.',
  )
}

function namedMethod(
  methods: Iterable<ResolvedMethod>,
  name: string,
  dispatch: 'static' | 'instance',
): ResolvedMethod | undefined {
  const expectedStatic = dispatch === 'static'
  return [...methods].find((method) => method.name === name && method.static === expectedStatic)
}

function description(
  path: Path,
  origin: string,
  className: string,
  callable: ResolvedMethod,
  dispatch: 'static' | 'instance',
): CallableDescription {
  return Object.freeze({
    path: path.raw,
    origin,
    class: className,
    method: callable.name,
    dispatch,
    ...callableFields(callable),
  })
}

function callableFields(callable: ResolvedFunction | ResolvedMethod): Partial<CallableDescription> {
  return {
    ...(callable.description === undefined ? {} : { description: callable.description }),
    auth: callable.auth,
    input: callable.input,
    output: callable.output,
  }
}
