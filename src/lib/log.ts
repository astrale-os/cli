import chalk from 'chalk'
import ora, { type Ora } from 'ora'

import { AstraleError, NotImplementedError } from '../errors'
import { printFailureDebug } from './failure-debug'
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

/** Report an error with hint (when present) and exit. `--json` / `--ci` / a
 *  non-TTY stdout always get one structured JSON line on stderr. */
export function fatal(e: unknown, opts?: MachineOpts & { readonly debug?: boolean }): never {
  // Ctrl-C at an interactive (@inquirer/prompts) prompt — exit quietly with the
  // SIGINT convention, not a red error line.
  if (e instanceof Error && e.name === 'ExitPromptError') process.exit(130)
  const msg =
    e instanceof AstraleError ? e.message : 'The CLI encountered an unexpected internal failure.'
  const code = e instanceof AstraleError ? e.code : 'UNEXPECTED_ERROR'
  if (isMachine(opts)) {
    const payload: Record<string, unknown> = { error: code, message: msg }
    if (e instanceof AstraleError && e.hint) payload.hint = e.hint
    process.stderr.write(JSON.stringify(payload) + '\n')
  } else {
    // Same shape as `renderFailure` (connection/failure): bold code, then the
    // hint as one dim detail line. Two renderers, one error to read.
    log.error(`${chalk.bold(code)}: ${msg}`)
    if (e instanceof AstraleError && e.hint) log.dim(`  ${e.hint}`)
  }
  if (opts?.debug) printFailureDebug(e, '')
  process.exit(1)
}

/** Project only a caller-authored admission failure into the CLI input family. */
export function failInput(error: unknown, opts?: MachineOpts): never {
  if (error instanceof AstraleError) fatal(error, opts)
  if (!(error instanceof TypeError)) fatal(error, opts)
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
  const spin = ora({ text, color: 'cyan', stream: target }).start()

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
