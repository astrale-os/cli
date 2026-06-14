import { input, select } from '@inquirer/prompts'
import chalk from 'chalk'
import { createInterface } from 'node:readline/promises'

/**
 * Prompt the user for Y/N confirmation. Returns true if confirmed.
 * Returns false in non-TTY environments (use --yes to bypass).
 */
export async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false

  process.stdout.write(chalk.yellow(`${message} [y/N] `))
  const answer = await readLine()
  return answer.toLowerCase() === 'y'
}

/**
 * Prompt with a Y default — design §7.1 "Y/n" semantics. Returns true
 * unless the user explicitly types `n`.
 */
export async function confirmDefaultYes(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true

  process.stdout.write(chalk.yellow(`${message} [Y/n] `))
  const answer = await readLine()
  return answer.toLowerCase() !== 'n'
}

/**
 * Prompt the user to type a specific string to confirm a dangerous action.
 * Returns false in non-TTY environments (use --yes to bypass).
 */
export async function confirmWithInput(message: string, expected: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false

  process.stdout.write(chalk.yellow(`${message}\n`))
  process.stdout.write(chalk.yellow(`  Type "${expected}" to confirm: `))
  const answer = await readLine()
  return answer === expected
}

/**
 * Free-text prompt (a styled `@inquirer/prompts` input — shows the default,
 * supports inline `validate` with live re-ask). Returns the typed value, or the
 * default on empty input.
 *
 * Gated on `process.stdin.isTTY` BEFORE touching inquirer (which requires a
 * TTY): in a piped / CI / no-TTY (LLM) run it returns the default (`undefined`
 * when none) immediately and renders nothing, so callers fall through to their
 * required-flag error instead of hanging on a read.
 */
export async function promptText(
  message: string,
  opts: { default?: string; validate?: (value: string) => boolean | string } = {},
): Promise<string | undefined> {
  if (!process.stdin.isTTY) return opts.default
  const answer = await input({
    message,
    ...(opts.default !== undefined ? { default: opts.default } : {}),
    ...(opts.validate ? { validate: opts.validate } : {}),
  })
  return answer.trim() || opts.default
}

/**
 * Single-choice selector (a styled `@inquirer/prompts` select with arrow-key
 * navigation). Returns the chosen value, or `undefined` in a non-TTY
 * environment — callers gate on a TTY before offering a choice, so this only
 * ever renders interactively.
 */
export async function promptSelect<T>(
  message: string,
  choices: Array<{ name: string; value: T; description?: string }>,
): Promise<T | undefined> {
  if (!process.stdin.isTTY) return undefined
  return select({ message, choices })
}

/** Attempts allowed before a selector gives up on invalid input. */
const SELECT_MAX_ATTEMPTS = 3

/**
 * Numbered single-choice selector. Prints the options and reads an index.
 * Invalid input re-prompts; an empty answer cancels. Returns null in
 * non-TTY environments, on cancel, or after repeated invalid input
 * (caller decides how to fail).
 */
export async function selectFrom<T>(
  message: string,
  choices: Array<{ label: string; value: T }>,
): Promise<T | null> {
  if (!process.stdin.isTTY) return null

  process.stdout.write(chalk.yellow(`${message}\n`))
  choices.forEach((choice, index) => {
    process.stdout.write(`  ${chalk.bold(String(index + 1))}. ${choice.label}\n`)
  })
  for (let attempt = 0; attempt < SELECT_MAX_ATTEMPTS; attempt++) {
    process.stdout.write(chalk.yellow(`Select [1-${choices.length}] (empty to cancel): `))
    const answer = await readLine()
    if (answer === '') return null
    // Whole-number input only: parseInt would accept "1.9" or "2x".
    if (/^\d+$/.test(answer)) {
      const choice = choices[Number.parseInt(answer, 10) - 1]
      if (choice) return choice.value
    }
  }
  return null
}

/** Prompt a passphrase without echoing. Fails in non-TTY unless env override. */
export async function readPassphrase(
  message: string,
  opts: { minLength?: number } = {},
): Promise<string> {
  const env = process.env.ASTRALE_PASSPHRASE
  if (env) return env
  if (!process.stdin.isTTY) {
    throw new Error('Passphrase required but no TTY. Pipe via ASTRALE_PASSPHRASE env var.')
  }
  // v1 note: passphrase echoes on interactive terminals. Pipe
  // ASTRALE_PASSPHRASE=... for scripted flows. Silent stdin with raw
  // mode is roadmap (requires terminal capabilities handling).
  process.stdout.write(chalk.yellow(message))
  const answer = await readLine()
  process.stdout.write('\n')
  if (opts.minLength && answer.length < opts.minLength) {
    throw new Error(`Passphrase too short (min ${opts.minLength} chars)`)
  }
  return answer
}

/**
 * Read one line from stdin via Node's own line reader (stdlib, zero-dep): it
 * gives real line editing and clean EOF/^D handling, instead of hand-managing
 * `stdin` 'data'/'end' listeners + pause/resume. Callers print their own
 * (colored) prompt first, so the query is empty; closing the interface each
 * call releases stdin so the next prompt starts clean. Only ever reached behind
 * an `isTTY` gate, so it never blocks a piped / CI / no-TTY (LLM) run.
 */
async function readLine(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question('')).trim()
  } finally {
    rl.close()
  }
}
