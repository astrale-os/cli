import { Path } from '@astrale-os/sdk/graph/path'
import { K } from '@astrale-os/sdk/schema'
import chalk from 'chalk'

import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program/index'

import { createPathCall, runKernelCommand } from '../../connection'
import { AstraleError } from '../../errors'
import { canPrompt } from '../../lib/interactive'
import { fatal, log } from '../../lib/log'
import { output } from '../../lib/output'
import { dangerPanel } from '../../lib/panel'
import { confirmWithInput } from '../../lib/prompt'

type UninstallOpts = KernelCommandOpts & {
  readonly yes?: boolean
  readonly destructive?: boolean
  readonly ci?: boolean
  readonly noPrompt?: boolean
}

type UninstallResult = {
  readonly operation: string
  readonly transitions: readonly {
    readonly intent: {
      readonly origin: string
    }
  }[]
}

/** Public Kernel uninstall syscall input for one canonical non-empty Domain set. */
export function uninstallCallInput(
  origins: readonly [string, ...string[]],
  mode: 'safe' | 'destructive' = 'safe',
  operation: string = crypto.randomUUID(),
): Readonly<{
  operation: string
  domains: readonly [string, ...string[]]
  data: Readonly<{ mode: 'safe' | 'destructive' }>
}> {
  return Object.freeze({
    operation,
    domains: canonicalOrigins(origins),
    data: Object.freeze({ mode }),
  })
}

export default {
  name: 'uninstall',
  description: 'Uninstall one or more domains through the public Kernel syscall',
  afterHelpText: `
Behavior:
  Atomically removes the exact selected set of installed Domains. Dependencies
  inside the set are allowed; a surviving dependent blocks the whole operation.

  Safe mode is the default and never deletes application data. --destructive
  deletes every application fact whose concrete Class is owned by a selected
  Domain. It does not cascade into unselected Domains, and a surviving foreign
  Edge that references a selected Node blocks the whole operation.

  Type the exact canonical Domain list to confirm, or pass --yes in automation.

  Use this before reinstalling only when an immutable Domain property (such as
  its issuer) intentionally changed. Ordinary compatible upgrades should use
  domain install directly and preserve the existing Domain identity.

Examples:
  $ astrale domain uninstall grc.example -i staging
  $ astrale domain uninstall app.example shared.example --destructive
  $ astrale domain uninstall grc.example -i staging --yes --json
`,
  arguments: [
    {
      name: 'origins',
      description: 'One or more installed Domain origins to remove atomically',
      required: true,
      variadic: true,
    },
  ],
  options: [
    {
      flags: '--destructive',
      description: 'Delete data typed by the selected Domains in the same atomic uninstall',
    },
    {
      flags: '--yes',
      description: 'Confirm the complete Domain uninstall without prompting',
    },
  ],
  action: async (origins: [string, ...string[]], opts: UninstallOpts) => {
    const selected = canonicalOrigins(origins)
    try {
      await confirmUninstall(selected, opts)
    } catch (error) {
      fatal(error, opts)
    }

    await runKernelCommand<UninstallResult>({
      opts,
      label: `Uninstalling ${selected.length === 1 ? 'domain' : 'domains'} ${selected.join(', ')}`,
      fn: async ({ session }) =>
        (await session.call(
          createPathCall(
            Path.project(K.functions.uninstall.ref).raw,
            uninstallCallInput(selected, opts.destructive ? 'destructive' : 'safe'),
          ),
        )) as UninstallResult,
      format: (result, formatOpts, machine) => {
        if (machine) {
          output(result, formatOpts)
          return
        }
        const removed = result.transitions.map(({ intent }) => intent.origin)
        log.success(
          `${removed.length === 1 ? 'Domain' : 'Domains'} uninstalled: ${removed.join(', ')}`,
        )
        log.dim(`  operation: ${result.operation}`)
      },
    })
  },
} satisfies CommandDefinition

async function confirmUninstall(
  origins: readonly [string, ...string[]],
  opts: UninstallOpts,
): Promise<void> {
  if (opts.yes) return

  const selection = origins.join(', ')
  const destructive = opts.destructive === true

  if (!canPrompt(opts)) {
    const subject = origins.length === 1 ? 'Domain' : 'Domains'
    throw new AstraleError(
      'CONFIRMATION_REQUIRED',
      `Uninstalling ${subject} "${selection}" requires explicit confirmation.`,
      `Re-run with --yes: astrale domain uninstall ${origins.join(' ')}${destructive ? ' --destructive' : ''} --yes`,
    )
  }

  const warning = dangerPanel(destructive ? 'DESTRUCTIVE DOMAIN UNINSTALL' : 'DOMAIN UNINSTALL', [
    `domains    ${chalk.bold(selection)}`,
    '',
    'This atomically removes the exact selected Domain set.',
    ...(destructive
      ? [
          'This permanently deletes application data owned by the selected Domains.',
          'Surviving dependents and foreign references still block removal.',
        ]
      : [
          'Safe mode never deletes application data.',
          'The Kernel refuses removal while dependents or selected data remain.',
        ]),
  ])
  if (!(await confirmWithInput(warning, selection))) {
    throw new AstraleError('UNINSTALL_CANCELLED', `Domain uninstall cancelled for "${selection}".`)
  }
}

function canonicalOrigins(origins: readonly [string, ...string[]]): readonly [string, ...string[]] {
  return Object.freeze([...new Set(origins)].sort(compare)) as [string, ...string[]]
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
