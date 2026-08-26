import type { DomainBundle, DomainInfo, SchemaApi } from '@astrale-os/sdk/client/schema'

import { Path } from '@astrale-os/sdk/graph/path'

import type { KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program/index'

import { runKernelCommand } from '../connection'
import { AstraleError } from '../errors'
import { failInput } from '../lib/log'
import { output } from '../lib/output'
import { describeCallableFromBundle, missingCallableDescription } from './call-describe'

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
      const includeBundle = wantsCallable || opts.bundle === true
      const result = await readInstalledDomain(session.schema, origin, includeBundle)
      if (wantsCallable) {
        const described = describeCallableFromBundle(path, (result as DomainBundle).bundle)
        if (described === undefined) throw missingCallableDescription(path.raw)
        return described
      }
      return result
    },
    format: (value, format) => output(value, format),
  })
}

export function readInstalledDomain(
  schema: Pick<SchemaApi, 'inspect' | 'bundle'>,
  origin: string,
  includeBundle: true,
): Promise<DomainBundle>
export function readInstalledDomain(
  schema: Pick<SchemaApi, 'inspect' | 'bundle'>,
  origin: string,
  includeBundle: false,
): Promise<DomainInfo>
export function readInstalledDomain(
  schema: Pick<SchemaApi, 'inspect' | 'bundle'>,
  origin: string,
  includeBundle: boolean,
): Promise<DomainInfo | DomainBundle>
export function readInstalledDomain(
  schema: Pick<SchemaApi, 'inspect' | 'bundle'>,
  origin: string,
  includeBundle: boolean,
): Promise<DomainInfo | DomainBundle> {
  return includeBundle ? schema.bundle(origin) : schema.inspect(origin)
}

export function parseIntrospectTarget(target: string): { origin: string; path: Path } {
  if (target.startsWith('@')) {
    throw new AstraleError(
      'NOT_A_DOMAIN',
      'introspect requires a Domain origin or Path, not an @id.',
      'Example: astrale introspect kernel.astrale.ai  or  /:kernel.astrale.ai:class.Identity:whois',
    )
  }
  const raw = target.startsWith('/') ? target : `/:${target}`
  let path: Path
  try {
    path = Path.parse(raw)
  } catch (error) {
    throw new AstraleError(
      'PATH_INVALID',
      error instanceof Error ? error.message : 'Invalid introspect target',
    )
  }
  if (path.ast.anchor.kind !== 'domain') {
    throw new AstraleError('NOT_A_DOMAIN', 'introspect requires a Domain-rooted Path or origin.')
  }
  return { origin: path.ast.anchor.origin, path }
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
  Calls the public Kernel introspect syscall for one installed Domain.
  A bare origin (kernel.astrale.ai or /:kernel.astrale.ai) prints installation
  state, target, source, readiness, and capabilities. --bundle includes the
  schema bundle. A method or Function Path projects that callable's
  input/output from the installed bundle.

Examples:
  $ astrale introspect kernel.astrale.ai
  $ astrale introspect /:kernel.astrale.ai --bundle
  $ astrale introspect /:kernel.astrale.ai:class.Identity:whois
  $ astrale introspect /:kernel.astrale.ai:function.journal
`,
  arguments: [{ name: 'target', description: 'Domain origin or canonical Path' }],
  options: [{ flags: '--bundle', description: 'Include the installed schema bundle' }],
  action: async (target, opts) => {
    await introspectCommand(target as string, opts as IntrospectOpts)
  },
} satisfies CommandDefinition
