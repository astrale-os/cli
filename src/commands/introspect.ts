import type { DomainBundle, DomainInfo, SchemaApi } from '@astrale-os/sdk/client/schema'
import type { ResolvedFunction, ResolvedMethod } from '@astrale-os/sdk/schema'

import { ResponseError } from '@astrale-os/sdk/client'
import { ClassKey } from '@astrale-os/sdk/graph/class'
import { Path } from '@astrale-os/sdk/graph/path'
import { bundle, schema } from '@astrale-os/sdk/schema'

import type { KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program/index'

import { runKernelCommand } from '../connection'
import { AstraleError } from '../errors'
import { failInput } from '../lib/terminal/log'
import { output } from '../lib/terminal/output'

type IntrospectOpts = KernelCommandOpts & { bundle?: boolean }

interface IntrospectDependencies {
  readonly runKernelCommand: typeof runKernelCommand
}

const defaultIntrospectDependencies = Object.freeze({ runKernelCommand })

export async function introspectCommand(
  target: string,
  opts: IntrospectOpts,
  dependencies: Partial<IntrospectDependencies> = {},
): Promise<void> {
  const introspect = { ...defaultIntrospectDependencies, ...dependencies }
  let origin: string
  let path: Path
  try {
    ;({ origin, path } = parseIntrospectTarget(target))
  } catch (error) {
    failInput(error, opts)
  }
  const wantsCallable = isCallablePath(path)

  await introspect.runKernelCommand({
    opts,
    label: `Introspect ${origin}`,
    fn: async ({ session }) => {
      if (wantsCallable) {
        const result = await readInstalledDomain(session.schema, origin, true)
        const described = describeCallableFromBundle(path, result.bundle)
        if (described === undefined)
          throw new AstraleError(
            'CALL_DESCRIBE_UNAVAILABLE',
            `No callable matches ${path.raw} in the installed schema.`,
            `Inspect installed methods with \`astrale introspect ${origin} --bundle\`.`,
          )
        return described
      }
      return readInstalledDomain(session.schema, origin, opts.bundle === true)
    },
    format: (value, format) => output(value, format),
  })
}

function readInstalledDomain(
  schema: Pick<SchemaApi, 'inspect' | 'bundle'>,
  origin: string,
  includeBundle: true,
): Promise<DomainBundle>
function readInstalledDomain(
  schema: Pick<SchemaApi, 'inspect' | 'bundle'>,
  origin: string,
  includeBundle: false,
): Promise<DomainInfo>
function readInstalledDomain(
  schema: Pick<SchemaApi, 'inspect' | 'bundle'>,
  origin: string,
  includeBundle: boolean,
): Promise<DomainInfo | DomainBundle>
async function readInstalledDomain(
  schema: Pick<SchemaApi, 'inspect' | 'bundle'>,
  origin: string,
  includeBundle: boolean,
): Promise<DomainInfo | DomainBundle> {
  try {
    return await (includeBundle ? schema.bundle(origin) : schema.inspect(origin))
  } catch (error) {
    if (isSchemaNotFound(error)) {
      throw new AstraleError(
        'DOMAIN_NOT_INSTALLED',
        `Domain "${origin}" is not installed on the target instance.`,
      )
    }
    throw error
  }
}

function isSchemaNotFound(error: unknown): boolean {
  if (!(error instanceof ResponseError) || error.code !== 1003) return false
  const reason = error.reason
  return (
    reason !== null &&
    typeof reason === 'object' &&
    !Array.isArray(reason) &&
    (reason as Readonly<Record<string, unknown>>).code === 'SCHEMA_NOT_FOUND'
  )
}

export function parseIntrospectTarget(target: string): { origin: string; path: Path } {
  const raw = target.startsWith('/') || target.startsWith('@') ? target : `/:${target}`
  let path: Path
  try {
    path = Path.parse(raw)
  } catch (error) {
    throw new AstraleError(
      'PATH_INVALID',
      error instanceof Error ? error.message : 'Invalid introspect target',
    )
  }
  const last = path.ast.steps.at(-1)
  if (last?.kind === 'method' && last.dispatch === 'instance') {
    return { origin: ClassKey.ref(last.class).origin, path }
  }
  if (path.ast.anchor.kind !== 'domain') {
    throw new AstraleError(
      'NOT_A_DOMAIN',
      'Use a Domain origin or an instance Method Path; a bare @id does not identify a schema.',
    )
  }
  const origin = path.ast.anchor.origin
  return { origin, path }
}

function isCallablePath(path: Path): boolean {
  const last = path.ast.steps.at(-1)
  if (last === undefined) return false
  if (last.kind === 'method') return true
  return last.kind === 'projection' && last.projection.kind === 'function'
}

export default {
  name: 'introspect',
  description: 'Read installed Domain schema from the Kernel Schema syscall',
  afterHelpText: `
Behavior:
  Calls the public SDK Schema API for one installed Domain. A bare origin
  (kernel.astrale.ai or /:kernel.astrale.ai) prints its exact revision,
  generation, publication, readiness, capabilities, and bindings. --bundle
  includes the schema bundle. A method or Function Path projects that
  callable's input/output from the installed bundle. Instance Method Paths
  may start with @id; their qualified Method key selects the schema without
  reading or invoking the receiver.

Examples:
  $ astrale introspect kernel.astrale.ai
  $ astrale introspect /:kernel.astrale.ai --bundle
  $ astrale introspect /:kernel.astrale.ai:class.Identity:whois
  $ astrale introspect @note::notes.example:class.Note.method.archive
`,
  arguments: [{ name: 'target', description: 'Domain origin or canonical Path' }],
  options: [{ flags: '--bundle', description: 'Include the installed schema bundle' }],
  action: async (target, opts) => {
    await introspectCommand(target as string, opts as IntrospectOpts)
  },
} satisfies CommandDefinition

interface CallableDescription {
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
  const last = path.ast.steps.at(-1)
  if (last === undefined) return undefined
  const methodClass =
    last.kind === 'method' && last.dispatch === 'instance' ? ClassKey.ref(last.class) : undefined
  const origin =
    methodClass?.origin ?? (path.ast.anchor.kind === 'domain' ? path.ast.anchor.origin : undefined)
  if (origin === undefined) return undefined
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
