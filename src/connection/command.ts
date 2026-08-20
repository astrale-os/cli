import chalk from 'chalk'

import type { ConnectionContext } from './session'
import type { ConnectionOptions } from './target'

import { formatElapsed } from '../lib/format'
import { spinner } from '../lib/log'
import { isMachine, present } from '../lib/output'
import { formatKernelError } from './errors'
import { withClientSession } from './session'

export interface KernelCommandOpts extends ConnectionOptions {
  readonly raw?: boolean
  readonly json?: boolean
  readonly format?: 'yaml' | 'json'
  readonly debug?: boolean
}

export interface OperationRecovery {
  readonly operation: string
  readonly retry: string
}

/**
 * Encapsulates the standard kernel command lifecycle:
 * spinner → connect → call → timing → output → error handling.
 *
 * Commands provide a `fn` that does the actual work and an optional
 * `format` callback for custom output. If `format` is omitted, the
 * result is passed to the standard `output()` function.
 */
export async function runKernelCommand<T>(input: {
  readonly opts: KernelCommandOpts
  readonly label: string
  readonly recovery?: OperationRecovery
  readonly fn: (context: ConnectionContext) => Promise<T>
  readonly format?: (
    result: T,
    options: KernelCommandOpts,
    machine: boolean,
  ) => void | Promise<void>
}): Promise<void> {
  const { opts, label, fn } = input
  const isRaw = isMachine(opts)
  const spin = !isRaw ? spinner(`${label}...`) : null
  const startTime = performance.now()

  try {
    const result = await withClientSession(opts, fn)
    const elapsed = performance.now() - startTime

    spin?.succeed(`${label} ${chalk.dim(formatElapsed(elapsed))}`)
    if (!isRaw) console.log('')

    if (input.format) {
      await input.format(result, opts, isRaw)
    } else {
      present(result, opts)
    }
  } catch (error) {
    if (!isRaw && spin) spin.fail(`${label} failed`)
    await formatKernelError(error, isRaw, undefined, opts.debug, {
      recovery: input.recovery,
    })
    process.exit(1)
  }
}
