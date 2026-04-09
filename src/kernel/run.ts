import chalk from 'chalk'

import type { ClientContext } from './client'
import type { KernelCommandOpts } from './types'

import { formatElapsed } from '../lib/format'
import { spinner } from '../lib/log'
import { isRawOutput, output } from '../lib/output'
import { withKernelClient } from './client'
import { formatKernelError } from './errors'

type RunOpts<T> = {
  opts: KernelCommandOpts
  label: string
  fn: (ctx: ClientContext) => Promise<T>
  format?: (result: T, opts: KernelCommandOpts, isRaw: boolean) => void
}

/**
 * Encapsulates the standard kernel command lifecycle:
 * spinner → connect → call → timing → output → error handling.
 *
 * Commands provide a `fn` that does the actual work and an optional
 * `format` callback for custom output. If `format` is omitted, the
 * result is passed to the standard `output()` function.
 */
export async function runKernelCommand<T>(run: RunOpts<T>): Promise<void> {
  const { opts, label, fn } = run
  const isRaw = isRawOutput(opts)
  const spin = !isRaw ? spinner(`${label}...`) : null
  const startTime = performance.now()

  try {
    const result = await withKernelClient(opts, fn)
    const elapsed = performance.now() - startTime

    spin?.succeed(`${label} ${chalk.dim(formatElapsed(elapsed))}`)
    if (!isRaw) console.log('')

    if (run.format) {
      run.format(result, opts, isRaw)
    } else {
      output(result, opts)
    }
  } catch (error) {
    if (!isRaw && spin) spin.fail(`${label} failed`)
    formatKernelError(error, isRaw, undefined, opts.debug)
    process.exit(1)
  }
}

/**
 * Normalize a `listChildren` response into an array of items.
 * The kernel may return a bare array or `{ items: [...] }`.
 */
export function extractItems<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result && typeof result === 'object') {
    const items = (result as { items?: unknown }).items
    if (Array.isArray(items)) return items as T[]
  }
  return []
}
