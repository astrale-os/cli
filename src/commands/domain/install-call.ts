import type { InstallExecutionId } from '@astrale-os/sdk/client/schema'

import chalk from 'chalk'

import type { KernelCommandOpts, OperationRecovery } from '../../connection'
import type { LifecycleContext } from '../../connection/installation-result'
import type { InstallPrecheck } from './install-precheck'

import { formatKernelError } from '../../connection/errors'
import { failureExitCode, renderInterruptedWait } from '../../connection/installation-result'
import { formatElapsed } from '../../lib/terminal/format'
import { fatal, log, spinner } from '../../lib/terminal/log'
import { isMachine } from '../../lib/terminal/output'

/**
 * Why an install or uninstall stopped, rendered once its Kernel session is closed: `input` failures
 * (an invalid reference, a refused consent) as command errors, `kernel` failures as Kernel command
 * failures with what the command knows of its operation.
 */
export interface InstallFailure {
  readonly error: unknown
  readonly render: 'input' | 'kernel'
  /** The operation the failed call sent, and the Execution the Kernel answered for it, if any. */
  readonly lifecycle?: LifecycleContext
  /**
   * The pre-check of an install the Kernel refused for dependency or dependent compatibility:
   * `--json` carries it beside the error, and a human sees its proposed grouped install again
   * under the refusal.
   */
  readonly precheck?: InstallPrecheck
}

/**
 * Run one Kernel install or uninstall call behind the command spinner and present its result, the
 * `runKernelCommand` lifecycle inside an already open session: the checks that precede the call
 * (Kernel probe, deployment reads, consent prompts) run before the spinner starts. The call learns
 * the Execution the Kernel answered through `started`, with the Kernel's `replayed` marker, so a
 * failure says whether one exists and the presentation whether the operation ran before.
 */
export async function runInstallCall<Result>(
  opts: KernelCommandOpts,
  step: {
    readonly lifecycle: 'install' | 'uninstall'
    readonly label: string
    readonly recovery: OperationRecovery
    readonly call: (
      started: (execution: InstallExecutionId, replayed?: boolean) => void,
    ) => Promise<Result>
    /** Whether the answer is an Execution still running: the wait ended without its outcome. */
    readonly running?: (result: Result) => boolean
    readonly format: (
      result: Result,
      machine: boolean,
      context: LifecycleContext,
    ) => void | Promise<void>
  },
): Promise<InstallFailure | undefined> {
  const machine = isMachine(opts)
  let execution: InstallExecutionId | undefined
  let replayed: boolean | undefined
  const context = (): LifecycleContext => ({
    lifecycle: step.lifecycle,
    recovery: step.recovery,
    ...(execution === undefined ? {} : { started: execution }),
    ...(replayed === undefined ? {} : { replayed }),
  })
  const spin = machine ? null : spinner(`${step.label}...`, { interruptible: true })
  // Ctrl-C (SIGINT) stops waiting, never the Execution: say where it continues, and exit 130, the
  // shell's convention for an interrupt.
  const interrupted = () => {
    spin?.stop()
    renderInterruptedWait(context(), machine)
    process.exit(130)
  }
  process.once('SIGINT', interrupted)
  const startTime = performance.now()
  try {
    const result = await step
      .call((answered, marker) => {
        execution = answered
        replayed = marker
      })
      .finally(() => process.off('SIGINT', interrupted))
    const elapsed = chalk.dim(formatElapsed(performance.now() - startTime))
    // A wait that ended before the Execution did is no failure: a neutral mark, not a cross.
    if (step.running?.(result) === true) spin?.info(`${step.label} still running ${elapsed}`)
    else spin?.succeed(`${step.label} ${elapsed}`)
    if (!machine) console.log('')
    await step.format(result, machine, context())
    return undefined
  } catch (error) {
    if (!machine && spin) spin.fail(`${step.label} failed`)
    return { error, render: 'kernel', lifecycle: context() }
  }
}

/**
 * Render one install or uninstall failure and exit: 2 for an Execution that ended `failed`, 5 for a
 * conflict over its operation or while another schema change is active, else 1.
 */
export async function exitWithInstallFailure(
  failure: InstallFailure,
  opts: KernelCommandOpts,
): Promise<never> {
  if (failure.render === 'input') fatal(failure.error, opts)
  const machine = isMachine(opts)
  await formatKernelError(failure.error, machine, undefined, opts.debug, {
    ...(failure.lifecycle === undefined ? {} : { lifecycle: failure.lifecycle }),
    ...(failure.precheck === undefined ? {} : { fields: { precheck: failure.precheck } }),
  })
  if (!machine && failure.precheck?.command !== undefined) {
    log.dim(`  The pre-check proposes: ${failure.precheck.command}`)
  }
  process.exit(failure.render === 'kernel' ? failureExitCode(failure.error) : 1)
}
