import type { Uninstallation } from '@astrale-os/sdk/client/schema'
import type { OperationId, UninstallReceipt, UninstallRequest } from '@astrale-os/sdk/client/schema'

import chalk from 'chalk'

import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program/index'

import { runKernelCommand } from '../../connection'
import { installationResult } from '../../connection/installation-result'
import { resolveTimeoutMs } from '../../connection/session'
import { AstraleError } from '../../errors'
import { shellCommand } from '../../lib/shell-command'
import { canPrompt } from '../../lib/terminal/interactive'
import { fatal, log } from '../../lib/terminal/log'
import { output } from '../../lib/terminal/output'
import { dangerPanel } from '../../lib/terminal/panel'
import { confirmWithInput } from '../../lib/terminal/prompt'
import { acceptDomainOperationId, createDomainOperationId } from './operation'

type UninstallOpts = KernelCommandOpts & {
  readonly yes?: boolean
  readonly destructive?: boolean
  readonly operation?: string
}

type UninstallResult = UninstallReceipt & Pick<Uninstallation, 'execution' | 'status'>

/** Public Kernel uninstall syscall input for one canonical non-empty Domain set. */
export function uninstallCallInput(
  origins: readonly [string, ...string[]],
  mode: 'safe' | 'destructive' = 'safe',
  operation: OperationId = createDomainOperationId('uninstall'),
): UninstallRequest {
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
  A fresh operation id is generated automatically. Use --operation only to
  retry or recover this exact uninstall after an outcome-unknown failure.

  Use this before reinstalling only when an immutable Domain property (such as
  its issuer) intentionally changed. Ordinary compatible upgrades should use
  domain install directly and preserve the existing Domain identity.

Examples:
  $ astrale domain uninstall grc.example -i staging
  $ astrale domain uninstall app.example shared.example --destructive
  $ astrale domain uninstall grc.example -i staging --yes --json
  $ astrale domain uninstall grc.example --operation 139137b5-af47-47ce-92b2-b64a2b0c63d7 --yes
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
    {
      flags: '--operation <uuid>',
      description: 'Reuse an exact uninstall operation id for explicit retry/recovery',
    },
  ],
  action: async (origins: [string, ...string[]], opts: UninstallOpts) => {
    const selected = canonicalOrigins(origins)
    let operation: OperationId
    try {
      operation =
        opts.operation === undefined
          ? createDomainOperationId('uninstall')
          : acceptDomainOperationId(opts.operation, 'uninstall')
      await confirmUninstall(selected, opts)
    } catch (error) {
      fatal(error, opts)
    }

    await runKernelCommand<UninstallResult>(uninstallKernelCommand(selected, opts, operation))
  },
} satisfies CommandDefinition

export function uninstallKernelCommand(
  selected: readonly [string, ...string[]],
  opts: UninstallOpts,
  operation: OperationId = opts.operation === undefined
    ? createDomainOperationId('uninstall')
    : acceptDomainOperationId(opts.operation, 'uninstall'),
): Parameters<typeof runKernelCommand<UninstallResult>>[0] {
  return {
    opts,
    label: `Uninstalling ${selected.length === 1 ? 'domain' : 'domains'} ${selected.join(', ')} (operation ${operation})`,
    recovery: { operation, retry: uninstallRetry(selected, operation, opts) },
    credential: { principal: 'caller' as const },
    fn: async ({ session }) => {
      const installation = await session.schema.uninstall(
        uninstallCallInput(
          selected,
          opts.destructive ? 'destructive' : 'safe',
          operation,
        ) as Parameters<typeof session.schema.uninstall>[0],
        opts.timeout === undefined ? undefined : { timeoutMs: resolveTimeoutMs(opts.timeout) },
      )
      return {
        ...installationResult(installation, 'uninstall'),
        execution: installation.execution,
        status: installation.status,
      }
    },
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
  }
}

function uninstallRetry(
  origins: readonly [string, ...string[]],
  operation: string,
  opts: UninstallOpts,
): string {
  const flag = (name: string, value: string | undefined) =>
    value === undefined ? [] : [name, value]
  return shellCommand([
    'astrale',
    'domain',
    'uninstall',
    ...origins,
    ...(opts.destructive ? ['--destructive'] : []),
    '--operation',
    operation,
    '--yes',
    ...flag('--url', opts.url),
    ...flag('-i', opts.instance),
    ...flag('--as', opts.as),
    ...flag('--timeout', opts.timeout),
  ])
}

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
