import chalk from 'chalk'
import ora, { type Ora } from 'ora'

import { AstraleError, NotImplementedError } from '../../errors'
import { formatElapsed } from './format'
import { isMachine, type MachineOpts } from './output'

export const log = {
  info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
  success: (msg: string) => console.log(chalk.green('✔'), msg),
  // Diagnostics never share stdout with command results. In particular,
  // --json/--raw consumers must receive exactly one parseable value there.
  warn: (msg: string) => console.error(chalk.yellow('⚠'), msg),
  error: (msg: string) => console.error(chalk.red('✖'), msg),
  step: (msg: string) => console.log(chalk.cyan('→'), msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),
}

/**
 * Refuse the command with one typed failure and exit 1: its code, message and hint, as one JSON line
 * on stderr for `--json` / `--ci` / a non-TTY stdout. Only a typed failure is accepted here; any
 * other value propagates to the binary's one report (`reportFailure`), which prints UNEXPECTED_ERROR.
 */
export function fatal(
  error: AstraleError,
  opts?: MachineOpts & { readonly debug?: boolean },
): never {
  if (isMachine(opts)) {
    const payload: Record<string, unknown> = { error: error.code, message: error.message }
    if (error.hint) payload.hint = error.hint
    if (error.details) payload.details = error.details
    process.stderr.write(JSON.stringify(payload) + '\n')
  } else {
    // Same shape as `renderFailure` (connection/errors): bold code, then the
    // hint as one dim detail line. Two renderers, one error to read.
    log.error(`${chalk.bold(error.code)}: ${error.message}`)
    if (error.hint) log.dim(`  ${error.hint}`)
  }
  if (opts?.debug) printFailureDebug(error, '')
  process.exit(1)
}

/**
 * Refuse a caller-authored admission failure as INVALID_INPUT: a TypeError raised while the
 * command read its own arguments, flags or input. Any other failure is rethrown unchanged.
 */
export function failInput(error: unknown, opts?: MachineOpts): never {
  if (error instanceof AstraleError) fatal(error, opts)
  if (!(error instanceof TypeError)) throw error
  fatal(
    new AstraleError(
      'INVALID_INPUT',
      error.message.trim() ? error.message : 'CLI input is invalid.',
    ),
    opts,
  )
}

/** Shortcut for stub commands that aren't wired in v1 (§15). */
export function fatalNotImplemented(feature: string, hint?: string): never {
  fatal(new NotImplementedError(feature, hint))
}

/** Maximum time a spinner may run before being forcefully stopped. */
const SPINNER_SAFETY_MS = 60_000

const IS_CI = !!(process.env.CI || process.env.CONTINUOUS_INTEGRATION || process.env.NO_SPINNER)

type SpinnerOptions = {
  readonly longRunningText?: string
  readonly safetyMs?: number
  /**
   * Leave the terminal's input as it is, so Ctrl-C raises SIGINT for the command to handle. By
   * default ora reads input in raw mode to discard it and re-raises Ctrl-C itself; under Bun that
   * re-raise did not happen, and Ctrl-C was swallowed while the spinner ran.
   */
  readonly interruptible?: boolean
}

type WithSpinnerOptions<T> = SpinnerOptions & {
  readonly success?: (result: T) => string
}

/**
 * Run an async operation behind a spinner. Pass `enabled: false` for
 * machine-readable output modes. Errors are rethrown after the spinner is
 * stopped (✖ label failed).
 *
 * On success the spinner line is cleared — commands print their own result.
 * Pass `opts.success` to instead persist a single final line
 * (✔ <success text> <elapsed>) so a command ends on one line, not a
 * spinner line + result line pair. `opts.longRunningText` replaces an animation
 * that reaches the safety limit with one durable status line.
 */
export async function withSpinner<T>(
  label: string,
  enabled: boolean,
  fn: () => Promise<T>,
  opts: WithSpinnerOptions<T> = {},
): Promise<T> {
  if (!enabled) return await fn()
  const spin = spinner(`${label}...`, {
    longRunningText: opts.longRunningText,
    safetyMs: opts.safetyMs,
  })
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

export function spinner(text: string, opts: SpinnerOptions = {}): Ora {
  const target = process.stderr

  // Animate only where the animation can be seen. A redirected stderr (`2>log`)
  // or CI gets the unstarted spinner: it writes nothing while running and still
  // persists one durable line on succeed/fail. Without this, ora auto-disables
  // itself on a non-TTY but `start()` still drops a stray `- label` line into
  // whatever is capturing stderr — including the JSON that machine mode emits
  // there.
  //
  // A zero-column terminal is refused for a harder reason: it is a real pty
  // state (`script`, some CI wrappers report isTTY with columns 0), and ora
  // guards the width with `?? 80`, which a 0 walks straight through. It then
  // divides by it, gets an Infinity line count, and `clear()` loops forever —
  // the command hangs instead of finishing.
  if (!target.writable || !target.isTTY || !target.columns || IS_CI) {
    return ora({ text, isEnabled: false })
  }

  // Hand ora the bare stream: ora 9 hooks `stream.write` by assignment to
  // interleave external writes, so any wrapper here must survive that
  // mutation (a get-only Proxy recurses infinitely and kills the spinner).
  // Backpressure is ora's job now — it pauses rendering until 'drain'.
  const spin = ora({
    text,
    color: 'cyan',
    stream: target,
    ...(opts.interruptible === true ? { discardStdin: false } : {}),
  }).start()

  const safety = setTimeout(() => {
    if (!spin.isSpinning) return
    if (opts.longRunningText) {
      spin.info(opts.longRunningText)
    } else {
      spin.stop()
    }
  }, opts.safetyMs ?? SPINNER_SAFETY_MS)
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

const MAXIMUM_DEBUG_FAILURES = 32

/** Print every cause of a failure, bounded, for `--debug`. */
export function printFailureDebug(error: unknown, url: string): void {
  process.stderr.write(`\n${chalk.dim('── debug ─────────────────')}\n`)
  if (url) process.stderr.write(`${chalk.dim(`url:   ${url}`)}\n`)
  const seen = new Set<unknown>()
  const pending: Array<{ value: unknown; relation: string }> = [{ value: error, relation: 'error' }]
  while (pending.length > 0 && seen.size < MAXIMUM_DEBUG_FAILURES) {
    const { value, relation } = pending.shift()!
    if (seen.has(value)) continue
    seen.add(value)
    if (!(value instanceof Error)) {
      process.stderr.write(`${chalk.dim(`${relation}: ${String(value)}`)}\n`)
      continue
    }
    process.stderr.write(
      `${chalk.dim(`${relation}: ${value.constructor.name}: ${value.message}`)}\n`,
    )
    if (value.stack) process.stderr.write(`${chalk.dim(value.stack)}\n`)
    if (value.cause !== undefined) pending.push({ value: value.cause, relation: 'caused by' })
    if (value instanceof AggregateError)
      for (const child of value.errors) pending.push({ value: child, relation: 'aggregate' })
  }
}
