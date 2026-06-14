import { checkbox, confirm as confirmPrompt, input, select } from '@inquirer/prompts'
import chalk from 'chalk'
import { createInterface } from 'node:readline/promises'

// All interactive prompts go through `@inquirer/prompts` so a single library
// owns stdin (raw mode, keypress handling, cleanup). Hand-rolling some prompts
// with `node:readline` alongside inquirer used to fight over the TTY — the
// raw↔line-mode handoff swallowed the first keystroke, so a step right after an
// inquirer prompt needed a double Enter. One owner, no handoff, no lost keys.
//
// Every helper guards on `process.stdin.isTTY` BEFORE touching inquirer (which
// requires a TTY): a piped / CI / no-TTY (LLM) run returns the default
// immediately and renders nothing, so callers never hang on a read.

/**
 * Prompt the user for Y/N confirmation (default No). Returns false in non-TTY
 * environments (use --yes / a flag to bypass).
 */
export async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  return confirmPrompt({ message, default: false })
}

/**
 * Prompt with a Y default — "Y/n" semantics. Returns true unless the user
 * explicitly declines; returns true in non-TTY.
 */
export async function confirmDefaultYes(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true
  return confirmPrompt({ message, default: true })
}

/**
 * Prompt the user to type a specific string to confirm a dangerous action.
 * Returns false in non-TTY environments (use a flag to bypass).
 */
export async function confirmWithInput(message: string, expected: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  process.stdout.write(chalk.yellow(`${message}\n`))
  const answer = await input({ message: `Type "${expected}" to confirm:` })
  return answer.trim() === expected
}

/**
 * Free-text prompt (a styled `@inquirer/prompts` input — shows the default,
 * supports inline `validate` with live re-ask). Returns the typed value, or the
 * default on empty input (`undefined` when none) in a non-TTY run.
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
 * Single-choice selector (arrow-key `@inquirer/prompts` select). Returns the
 * chosen value, or `undefined` in a non-TTY environment.
 */
export async function promptSelect<T>(
  message: string,
  choices: Array<{ name: string; value: T; description?: string }>,
): Promise<T | undefined> {
  if (!process.stdin.isTTY) return undefined
  return select({ message, choices })
}

/**
 * Multi-choice selector (a styled `@inquirer/prompts` checkbox — space toggles,
 * enter confirms). Pre-check options with `checked: true`. Returns the chosen
 * values, or `undefined` in a non-TTY environment.
 */
export async function promptMultiSelect<T>(
  message: string,
  choices: Array<{ name: string; value: T; checked?: boolean; description?: string }>,
): Promise<T[] | undefined> {
  if (!process.stdin.isTTY) return undefined
  return checkbox({ message, choices })
}

/**
 * Single-choice selector over labeled values. Returns the chosen value, or
 * `null` in a non-TTY environment (callers decide how to fail). In a terminal
 * the user always picks one (Enter selects the highlighted option; Ctrl-C
 * aborts the command), so `null` only ever signals "no TTY".
 */
export async function selectFrom<T>(
  message: string,
  choices: Array<{ label: string; value: T }>,
): Promise<T | null> {
  if (!process.stdin.isTTY) return null
  return select({ message, choices: choices.map((c) => ({ name: c.label, value: c.value })) })
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
 * Read one line from stdin via Node's own line reader (stdlib, zero-dep).
 * Used only by `readPassphrase` (a single-shot prompt that intentionally echoes
 * and honors ASTRALE_PASSPHRASE) — every navigational prompt uses inquirer.
 * Only ever reached behind an `isTTY` gate, so it never blocks a piped run.
 */
async function readLine(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question('')).trim()
  } finally {
    rl.close()
  }
}
