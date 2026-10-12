import { call, type Call } from '@astrale-os/sdk/client'
import { Path } from '@astrale-os/sdk/graph/path'
import chalk from 'chalk'

import type { CredentialIntent } from './credential'
import type { ConnectionContext } from './session'
import type { AdminTargetSelection, ConnectionOptions } from './target'

import { formatElapsed } from '../lib/terminal/format'
import { spinner } from '../lib/terminal/log'
import { isMachine, present } from '../lib/terminal/output'
import { executionPending, formatKernelError, renderPendingResult } from './errors'
import { failureExitCode } from './installation-result'
import { withAdminClientSession, withClientSession } from './session'

export interface KernelCommandOpts extends ConnectionOptions {
  readonly raw?: boolean
  readonly json?: boolean
  readonly format?: 'yaml' | 'json'
  readonly debug?: boolean
}

export interface OperationRecovery {
  readonly operation: string
  /** The same command without `--operation`: a fresh operation, a new attempt. */
  readonly fresh: string
  /** The flags that select the same Instance and identity, for the commands that follow an Execution. */
  readonly target?: readonly string[]
}

/** Exit status of a result read whose Execution is still running: try again later (EX_TEMPFAIL). */
export const TRY_LATER_EXIT = 75

/** The Execution a result read is for, and the commands that follow it once it is still running. */
export interface PendingFollowUp {
  readonly execution: string
  /** The command that waits for its outcome. */
  readonly follow: string
  /** The command that reads its status. */
  readonly observe: string
  /** Whether this read waited (`--wait`) before the Kernel answered that it has not ended. */
  readonly waited: boolean
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
  /** Run on the Admin kernel, selected like `domain` Admin commands select it, not -i/--url/active. */
  readonly admin?: AdminTargetSelection
  readonly credential?: CredentialIntent
  /**
   * A result read: an Execution that has not ended is no failure but a neutral "still running",
   * the commands that follow it, and exit {@link TRY_LATER_EXIT}.
   */
  readonly pending?: PendingFollowUp
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
    const result = await (input.admin === undefined
      ? withClientSession(opts, fn, input.credential)
      : withAdminClientSession(
          {
            ...opts,
            admin: input.admin.admin,
            adminUrl: input.admin.adminUrl,
            domainIssuer: input.admin.domainIssuer,
          },
          fn,
          input.credential,
        ))
    const elapsed = performance.now() - startTime

    spin?.succeed(`${label} ${chalk.dim(formatElapsed(elapsed))}`)
    if (!isRaw) console.log('')

    if (input.format) {
      await input.format(result, opts, isRaw)
    } else {
      present(result, opts)
    }
  } catch (error) {
    if (input.pending !== undefined && executionPending(error)) {
      spin?.info(
        `${label} still running ${chalk.dim(formatElapsed(performance.now() - startTime))}`,
      )
      if (!isRaw) console.log('')
      await renderPendingResult(error, input.pending, isRaw, opts.debug)
      process.exit(TRY_LATER_EXIT)
    }
    if (!isRaw && spin) spin.fail(`${label} failed`)
    await formatKernelError(error, isRaw, undefined, opts.debug)
    process.exit(failureExitCode(error))
  }
}

/** Convert the CLI's untrusted text/JSON boundary into the one public Call representation. */
export function createPathCall(path: string, input: unknown): Call {
  return call(Path.parse(path), input as Parameters<typeof call>[1])
}
