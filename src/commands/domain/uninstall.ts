import type { Uninstallation } from '@astrale-os/sdk/client/schema'
import type { OperationId, UninstallReceipt, UninstallRequest } from '@astrale-os/sdk/client/schema'

import chalk from 'chalk'

import type { KernelCommandOpts, OperationRecovery } from '../../connection'
import type { Lifecycle, LifecycleContext } from '../../connection/installation-result'
import type { CommandDefinition } from '../../program/index'
import type { InstallFailure } from './install-call'

import { withClientSession } from '../../connection'
import {
  announcingLifecycle,
  completedExecutionLine,
  conflictFailure,
  installationResult,
  renderRunning,
  runningReport,
  stillRunning,
} from '../../connection/installation-result'
import { resolveTimeoutMs } from '../../connection/session'
import { targetFlags } from '../../connection/target'
import { AstraleError } from '../../errors'
import { shellCommand } from '../../lib/shell-command'
import { canPrompt } from '../../lib/terminal/interactive'
import { fatal, log } from '../../lib/terminal/log'
import { output } from '../../lib/terminal/output'
import { dangerPanel } from '../../lib/terminal/panel'
import { confirmWithInput } from '../../lib/terminal/prompt'
import { exitWithInstallFailure, runInstallCall } from './install-call'
import { acceptDomainOperationId, createDomainOperationId } from './operation'

type UninstallOpts = KernelCommandOpts & {
  readonly yes?: boolean
  readonly destructive?: boolean
  readonly operation?: string
}

/** A completed uninstall's receipt with its Execution, or its Execution still running. */
type UninstallResult =
  | (UninstallReceipt & Pick<Uninstallation, 'execution' | 'status'>)
  | { readonly running: Uninstallation }

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
  Edge that references a selected Node blocks the whole operation. One
  uninstall deletes at most the Host's bound of each Class (10000 facts or
  10000000 bytes in the production profile): above it, in either mode, the
  uninstall is refused and the count it reports is a lower bound ("at
  least"). Delete facts of that Class until it is under the bound first.

  Type the exact canonical Domain list to confirm, or pass --yes in automation.
  A fresh operation id is generated automatically; its outcome is final. An
  uninstall that ended (failed or cancelled) used its operation: try again
  without --operation ("fresh"). A failure exits 2 when the uninstall ended
  failed, 5 when it was refused as an operation conflict or while another
  schema change is active (SCHEMA_CHANGE_ACTIVE), else 1; --json
  carries the execution, "observe" and, once the operation is used, "fresh".
  --operation is for automation: a reused id replays only the exact same
  uninstall. Any other request under that id is
  refused as an operation conflict: nothing runs, and the CLI names the
  execution the id belongs to. An uninstall still running at --timeout is no
  failure: the CLI prints its execution and how to follow it, and exits 0.
  Ctrl-C stops waiting, never the uninstall: the CLI names its execution and
  exits 130.

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
      description: 'Operation id for automation; a reused id replays only the same request',
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

    const command = uninstallKernelCommand(selected, opts, operation)
    const failure = await withClientSession(
      opts,
      async ({ session }) =>
        runInstallCall(opts, {
          lifecycle: 'uninstall',
          label: command.label,
          recovery: command.recovery,
          // A conflict over the operation refuses this uninstall: the request it names is read
          // only to say which one it is.
          call: (started) =>
            command.fn(announcingLifecycle(session, started)).catch(async (error: unknown) => {
              throw await conflictFailure(error, session.schema)
            }),
          running: (result) => 'running' in result,
          format: (result, machine, context) => command.format(result, opts, machine, context),
        }),
      command.credential,
    ).catch((error: unknown): InstallFailure => ({ error, render: 'kernel' }))
    if (failure !== undefined) await exitWithInstallFailure(failure, opts)
  },
} satisfies CommandDefinition

/** One uninstall: its label, its operation recovery, and the call over the uninstall syscall. */
export function uninstallKernelCommand(
  selected: readonly [string, ...string[]],
  opts: UninstallOpts,
  operation: OperationId = opts.operation === undefined
    ? createDomainOperationId('uninstall')
    : acceptDomainOperationId(opts.operation, 'uninstall'),
) {
  const recovery: OperationRecovery = {
    operation,
    fresh: uninstallCommand(selected, opts),
    target: targetFlags(opts),
  }
  return {
    opts,
    label: `Uninstalling ${selected.length === 1 ? 'domain' : 'domains'} ${selected.join(', ')} (operation ${operation})`,
    recovery,
    credential: { principal: 'caller' as const },
    fn: async (lifecycle: Pick<Lifecycle, 'uninstall'>): Promise<UninstallResult> => {
      const installation = await lifecycle.uninstall(
        uninstallCallInput(
          selected,
          opts.destructive ? 'destructive' : 'safe',
          operation,
        ) as Parameters<Lifecycle['uninstall']>[0],
        opts.timeout === undefined ? undefined : { timeoutMs: resolveTimeoutMs(opts.timeout) },
      )
      if (stillRunning(installation.status)) return { running: installation }
      return {
        ...installationResult(installation, 'uninstall'),
        execution: installation.execution,
        status: installation.status,
      }
    },
    format: (
      result: UninstallResult,
      formatOpts: KernelCommandOpts,
      machine: boolean,
      context: LifecycleContext,
    ) => {
      if ('running' in result) {
        if (machine) output(runningReport(result.running, context), formatOpts)
        else renderRunning(result.running, context, true)
        return
      }
      if (machine) {
        output(result, formatOpts)
        return
      }
      const removed = result.transitions.map(({ intent }) => intent.origin)
      log.success(
        `${removed.length === 1 ? 'Domain' : 'Domains'} uninstalled: ${removed.join(', ')}`,
      )
      log.dim(`  operation: ${result.operation}`)
      log.dim(`  ${completedExecutionLine(result)}`)
    },
  }
}

/** This uninstall as a command line, with a fresh operation. */
function uninstallCommand(origins: readonly [string, ...string[]], opts: UninstallOpts): string {
  return shellCommand([
    'astrale',
    'domain',
    'uninstall',
    ...origins,
    ...(opts.destructive ? ['--destructive'] : []),
    '--yes',
    ...targetFlags(opts),
    ...(opts.timeout === undefined ? [] : ['--timeout', opts.timeout]),
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
