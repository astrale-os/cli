import chalk from 'chalk'

import type { KernelCommandOpts, OperationRecovery } from '../../connection'

import { formatKernelError } from '../../connection/errors'
import { formatElapsed } from '../../lib/format'
import { fatal, spinner } from '../../lib/log'
import { isMachine } from '../../lib/output'

/**
 * Why a URL install stopped, rendered once its Kernel session is closed: `input` failures (an
 * invalid reference, a refused consent) as command errors, `kernel` failures as Kernel command
 * failures with their operation recovery, exactly as `runKernelCommand` renders them.
 */
export interface InstallFailure {
  readonly error: unknown
  readonly render: 'input' | 'kernel'
  readonly recovery?: OperationRecovery
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
  await formatKernelError(failure.error, isMachine(opts), undefined, opts.debug, {
    recovery: failure.recovery,
  })
  process.exit(1)
}
