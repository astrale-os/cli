import chalk from 'chalk'
import ora, { type Ora } from 'ora'

import { AstraleError, NotImplementedError } from '../errors'
import { formatElapsed } from './format'

export const log = {
  info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
  success: (msg: string) => console.log(chalk.green('✔'), msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
  error: (msg: string) => console.error(chalk.red('✖'), msg),
  step: (msg: string) => console.log(chalk.cyan('→'), msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),
}

/** Report an error with hint (when present) and exit. */
export function fatal(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e)
  log.error(msg)
  if (e instanceof AstraleError && e.hint) log.dim(`  hint: ${e.hint}`)
  process.exit(1)
}

/** Shortcut for stub commands that aren't wired in v1 (§15). */
export function fatalNotImplemented(feature: string, hint?: string): never {
  fatal(new NotImplementedError(feature, hint))
}

/** Maximum time a spinner may run before being forcefully stopped. */
const SPINNER_SAFETY_MS = 60_000

const IS_CI = !!(process.env.CI || process.env.CONTINUOUS_INTEGRATION || process.env.NO_SPINNER)

/**
 * Run an async operation behind a spinner. Pass `enabled: false` for
 * machine-readable output modes. Errors are rethrown after the spinner is
 * stopped (✖ label failed).
 *
 * On success the spinner line is cleared — commands print their own result.
 * Pass `opts.success` to instead persist a single final line
 * (✔ <success text> <elapsed>) so a command ends on one line, not a
 * spinner line + result line pair.
 */
export async function withSpinner<T>(
  label: string,
  enabled: boolean,
  fn: () => Promise<T>,
  opts: { success?: (result: T) => string } = {},
): Promise<T> {
  if (!enabled) return await fn()
  const spin = spinner(`${label}...`)
  const start = performance.now()
  try {
    const result = await fn()
    if (opts.success) {
      spin.succeed(`${opts.success(result)} ${chalk.dim(formatElapsed(performance.now() - start))}`)
    } else {
      spin.stop()
    }
    return result
  } catch (error) {
    spin.fail(`${label} failed`)
    throw error
  }
}

export function spinner(text: string): Ora {
  const target = process.stderr

  if (!target.writable || IS_CI) {
    return ora({ text, isEnabled: false })
  }

  // Hand ora the bare stream: ora 9 hooks `stream.write` by assignment to
  // interleave external writes, so any wrapper here must survive that
  // mutation (a get-only Proxy recurses infinitely and kills the spinner).
  // Backpressure is ora's job now — it pauses rendering until 'drain'.
  const spin = ora({ text, color: 'cyan', stream: target }).start()

  const safety = setTimeout(() => {
    if (spin.isSpinning) spin.stop()
  }, SPINNER_SAFETY_MS)
  safety.unref()

  const onTargetError = () => {
    if (spin.isSpinning) spin.stop()
  }
  target.once('error', onTargetError)

  const cleanup = () => {
    clearTimeout(safety)
    target.removeListener('error', onTargetError)
  }

  const origSucceed = spin.succeed.bind(spin)
  const origFail = spin.fail.bind(spin)
  const origStop = spin.stop.bind(spin)

  spin.succeed = (text?: string) => {
    cleanup()
    return origSucceed(text)
  }
  spin.fail = (text?: string) => {
    cleanup()
    return origFail(text)
  }
  spin.stop = () => {
    cleanup()
    return origStop()
  }

  return spin
}
