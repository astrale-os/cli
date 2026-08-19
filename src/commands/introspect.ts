import { Path } from '@astrale-os/sdk/graph/path'

import type { KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program/index'

import { runKernelCommand } from '../connection'
import { AstraleError } from '../errors'
import { failClosed } from '../lib/log'
import { output } from '../lib/output'
import { describeCallableFromSchema, missingCallableDescription } from './call-describe'

type IntrospectOpts = KernelCommandOpts & { bundle?: boolean }

export async function introspectCommand(target: string, opts: IntrospectOpts): Promise<void> {
  let origin: string
  let path: Path
  try {
    ;({ origin, path } = parseIntrospectTarget(target))
  } catch (error) {
    failClosed(error, opts)
  }
  const wantsCallable = isCallablePath(path)

  await runKernelCommand({
    opts,
    label: `Introspect ${origin}`,
    fn: async ({ session }) => {
      const includeBundle = wantsCallable || opts.bundle === true
      const result = await session.schema.introspect({
        from: { kind: 'installation', origin },
        select: {
          state: true,
          target: true,
          source: true,
          readiness: true,
          capabilities: true,
          ...(includeBundle ? { bundle: true as const } : {}),
        },
      })
      if (result === null) {
        throw new AstraleError(
          'DOMAIN_NOT_INSTALLED',
          `Domain ${origin} is not installed on this Kernel.`,
        )
      }
      if (wantsCallable) {
        const described = describeCallableFromSchema(path, bundleRoot(result.bundle))
        if (described === undefined) throw missingCallableDescription(path.raw)
        return described
      }
      return result
    },
    format: (value, format) => output(value, format),
  })
}

export function parseIntrospectTarget(target: string): { origin: string; path: Path } {
  if (target.startsWith('@')) {
    throw new AstraleError(
      'NOT_A_DOMAIN',
      'introspect requires a Domain origin or Path, not an @id.',
      'Example: astrale introspect host.astrale.ai  or  /:host.astrale.ai:class.Manager:createInstance',
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

function bundleRoot(bundle: unknown): unknown {
  if (bundle !== null && typeof bundle === 'object' && 'root' in bundle) {
    return (bundle as { root: unknown }).root
  }
  return bundle
}

export default {
  name: 'introspect',
  description: 'Read installed Domain schema from the Kernel Schema syscall',
  afterHelpText: `
Behavior:
  Calls the public Kernel introspect syscall for one installed Domain.
  A bare origin (host.astrale.ai or /:host.astrale.ai) prints installation
  state, target, source, readiness, and capabilities. --bundle includes the
  schema bundle. A method or Function Path projects that callable's
  input/output from the installed bundle.

Examples:
  $ astrale introspect host.astrale.ai
  $ astrale introspect /:host.astrale.ai --bundle
  $ astrale introspect /:host.astrale.ai:class.Manager:createInstance
  $ astrale introspect /:kernel.astrale.ai:function.journal
`,
  arguments: [{ name: 'target', description: 'Domain origin or canonical Path' }],
  options: [{ flags: '--bundle', description: 'Include the installed schema bundle' }],
  action: async (target, opts) => {
    await introspectCommand(target as string, opts as IntrospectOpts)
  },
} satisfies CommandDefinition
