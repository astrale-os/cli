import chalk from 'chalk'

import type { KernelCommandOpts, OperationRecovery } from '../../connection'
import type { InstallPrecheck } from './install-precheck'

import { formatKernelError } from '../../connection/errors'
import { formatElapsed } from '../../lib/format'
import { fatal, log, spinner } from '../../lib/log'
import { isMachine } from '../../lib/output'

/** One deployment URL to install, as written, beside the host name that serves it. */
export interface UrlSource {
  readonly url: string
  readonly host: string
}

/**
 * Why a URL install stopped, rendered once its Kernel session is closed: `input` failures (an
 * invalid reference, a refused consent) as command errors, `kernel` failures as Kernel command
 * failures with their operation recovery, exactly as `runKernelCommand` renders them.
 */
export interface InstallFailure {
  readonly error: unknown
  readonly render: 'input' | 'kernel'
  readonly recovery?: OperationRecovery
  /**
   * The pre-check of an install the Kernel refused for dependency or dependent compatibility:
   * `--json` carries it beside the error, and a human sees its proposed grouped install again
   * under the refusal.
   */
  readonly precheck?: InstallPrecheck
}

/**
 * Run one Kernel install call behind the command spinner and present its result, the
 * `runKernelCommand` lifecycle inside an already open session: the checks that precede the call
 * (Kernel probe, deployment reads, consent prompts) run before the spinner starts.
 */
export async function runInstallCall<Result>(
  opts: KernelCommandOpts,
  step: {
    readonly label: string
    readonly recovery: OperationRecovery
    readonly call: () => Promise<Result>
    readonly format: (result: Result, machine: boolean) => void | Promise<void>
  },
): Promise<InstallFailure | undefined> {
  const machine = isMachine(opts)
  const spin = machine ? null : spinner(`${step.label}...`)
  const startTime = performance.now()
  try {
    const result = await step.call()
    spin?.succeed(`${step.label} ${chalk.dim(formatElapsed(performance.now() - startTime))}`)
    if (!machine) console.log('')
    await step.format(result, machine)
    return undefined
  } catch (error) {
    if (!machine && spin) spin.fail(`${step.label} failed`)
    return { error, render: 'kernel', recovery: step.recovery }
  }
}

/** Render one install failure and exit 1. */
export async function exitWithInstallFailure(
  failure: InstallFailure,
  opts: KernelCommandOpts,
): Promise<never> {
  if (failure.render === 'input') fatal(failure.error, opts)
  const machine = isMachine(opts)
  await formatKernelError(failure.error, machine, undefined, opts.debug, {
    recovery: failure.recovery,
    ...(failure.precheck === undefined ? {} : { fields: { precheck: failure.precheck } }),
  })
  if (!machine && failure.precheck?.command !== undefined) {
    log.dim(`  The pre-check proposes: ${failure.precheck.command}`)
  }
  process.exit(1)
}
