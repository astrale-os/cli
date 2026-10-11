/**
 * One rule for "is a human on the other end, and did they agree to be asked?".
 * Every prompt and the startup-maintenance gate answer it here, so a new
 * question inherits the whole policy instead of re-deriving a fragment of it.
 *
 * The rule reads argv, not the command's parsed options, on purpose: `--ci` and
 * `--no-prompt` are declared on the ROOT program, so Commander routes them to
 * `program.opts()` and never into a subcommand's action arguments. `opts.ci`
 * inside a command action is always `undefined` — argv is the only place those
 * two flags survive. `ci` / `noPrompt` remain accepted here because internal
 * callers (and tests) drive commands as functions, with no argv to speak for
 * them; on the CLI path they are simply always absent.
 *
 * Every input is injectable so the policy is testable without touching real
 * process state.
 */

/** Flags by which an invocation says nobody is there to answer a question. */
const NON_INTERACTIVE_FLAGS = new Set(['--ci', '--no-prompt', '--json', '--raw'])

/** The two that mean "do not interact", as opposed to "shape the output". */
const INTERACTION_OPT_OUT = new Set(['--ci', '--no-prompt'])

export type PromptGate = {
  /** Programmatic opt-out, for callers that drive a command as a function. */
  readonly ci?: boolean
  readonly noPrompt?: boolean
  /** Injectable process state — defaults to the live process. */
  readonly argv?: readonly string[]
  readonly env?: NodeJS.ProcessEnv
  /** A human on both ends: stdin AND stdout are terminals. */
  readonly tty?: boolean
}

function resolve(gate: PromptGate): {
  argv: readonly string[]
  env: NodeJS.ProcessEnv
  tty: boolean
} {
  return {
    argv: gate.argv ?? process.argv,
    env: gate.env ?? process.env,
    tty: gate.tty ?? (process.stdin.isTTY === true && process.stdout.isTTY === true),
  }
}

function available(gate: PromptGate): boolean {
  if (gate.ci === true || gate.noPrompt === true) return false
  const { env, tty } = resolve(gate)
  return tty && !env.CI && !env.CONTINUOUS_INTEGRATION
}

/**
 * May the CLI ask an optional question — a confirmation, a picker, a field it
 * could also read from a flag? Requires an interactive terminal, no CI runner,
 * and an invocation that did not opt out. `--json` / `--raw` count as opting
 * out: the caller asked for data, and a question would corrupt that stream or
 * hang an agent waiting on it.
 */
export function canPrompt(gate: PromptGate = {}): boolean {
  if (!available(gate)) return false
  return !resolve(gate).argv.some((token) => NON_INTERACTIVE_FLAGS.has(token))
}

/**
 * May the CLI read input the command cannot proceed without, such as a
 * passphrase? Same rule minus the output flags: `--json` shapes the result, it
 * does not mean the operator left. `--ci` / `--no-prompt` still refuse — those
 * promise that nothing will block — and the caller is expected to offer a
 * non-interactive path (an env var, a flag) in that case.
 */
export function canReadRequiredInput(gate: PromptGate = {}): boolean {
  if (!available(gate)) return false
  return !resolve(gate).argv.some((token) => INTERACTION_OPT_OUT.has(token))
}
