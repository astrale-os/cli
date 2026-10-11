import { checkbox, input, password, select } from '@inquirer/prompts'
import chalk from 'chalk'

import { canPrompt, canReadRequiredInput, type PromptGate } from './interactive'

// All interactive prompts go through `@inquirer/prompts` so a single library
// owns stdin (raw mode, keypress handling, cleanup). Hand-rolling some prompts
// with `node:readline` alongside inquirer used to fight over the TTY — the
// raw↔line-mode handoff swallowed the first keystroke, so a step right after an
// inquirer prompt needed a double Enter. One owner, no handoff, no lost keys.
//
// One interaction model too: every question — yes/no included — is answered by
// moving a cursor with the arrow keys and pressing Enter. No prompt ever asks
// the user to type a letter and confirm it (the old "(Y/n)" style), so the keys
// that answer the first question of a run answer every one after it.
//
// Every helper asks `canPrompt()` BEFORE touching inquirer (which requires a
// TTY): a piped / CI / --no-prompt / agent run takes the caller's default
// immediately and renders nothing, so nothing ever blocks on a read that will
// not come.

/**
 * Where prompt UI is drawn. stderr when it is a terminal — same choice as the
 * spinner — so a command's stdout carries its result and nothing else; stdout
 * otherwise, so a run with stderr redirected to a file still shows the question
 * instead of appearing to hang.
 */
function promptContext(): { output: NodeJS.WritableStream } {
  return { output: process.stderr.isTTY ? process.stderr : process.stdout }
}

/**
 * Ctrl-C at a prompt is an abort, not a failure: honor the shell's SIGINT
 * convention here, where the only inquirer calls live. Letting the library's
 * `ExitPromptError` travel on would leave the outcome to whichever catch block
 * happens to be downstream — `fatal` knows that error, but a command ending on
 * `formatKernelError` renders a plain interrupt as an internal failure.
 */
async function ask<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof Error && error.name === 'ExitPromptError') process.exit(130)
    throw error
  }
}

/**
 * Yes/No question as an arrow-key selector (↑/↓ move, Enter answers) with the
 * cursor parked on `default`. Returns `undefined` when the terminal is not
 * interactive, so callers can tell "the user declined" from "there was nobody
 * to ask".
 */
export async function promptYesNo(
  message: string,
  opts: { default?: boolean } & PromptGate = {},
): Promise<boolean | undefined> {
  if (!canPrompt(opts)) return undefined
  return ask(() =>
    select(
      {
        message,
        choices: [
          { name: 'Yes', value: true },
          { name: 'No', value: false },
        ],
        default: opts.default ?? false,
      },
      promptContext(),
    ),
  )
}

/**
 * Yes/No selector defaulting to No. Returns false when not interactive (use
 * --yes / a flag to bypass).
 */
export async function confirm(message: string, gate: PromptGate = {}): Promise<boolean> {
  return (await promptYesNo(message, { ...gate, default: false })) ?? false
}

/**
 * Yes/No selector defaulting to Yes — the cursor starts on Yes, so Enter
 * accepts. Returns true unless the user explicitly declines; returns true when
 * not interactive.
 */
export async function confirmDefaultYes(message: string, gate: PromptGate = {}): Promise<boolean> {
  return (await promptYesNo(message, { ...gate, default: true })) ?? true
}

/**
 * Prompt the user to type a specific string to confirm a dangerous action —
 * deliberately heavier than a selector, so a stray Enter cannot trigger one.
 * Returns false when not interactive (use a flag to bypass).
 */
export async function confirmWithInput(
  message: string,
  expected: string,
  gate: PromptGate = {},
): Promise<boolean> {
  if (!canPrompt(gate)) return false
  const context = promptContext()
  context.output.write(chalk.yellow(`${message}\n`))
  const answer = await ask(() => input({ message: `Type "${expected}" to confirm:` }, context))
  return answer.trim() === expected
}

/**
 * Free-text prompt (a styled `@inquirer/prompts` input — shows the default,
 * supports inline `validate` with live re-ask). Returns the typed value, or the
 * default on empty input (`undefined` when none) when not interactive.
 */
export async function promptText(
  message: string,
  opts: {
    default?: string
    validate?: (value: string) => boolean | string
  } & PromptGate = {},
): Promise<string | undefined> {
  if (!canPrompt(opts)) return opts.default
  const answer = await ask(() =>
    input(
      {
        message,
        ...(opts.default !== undefined ? { default: opts.default } : {}),
        ...(opts.validate ? { validate: opts.validate } : {}),
      },
      promptContext(),
    ),
  )
  return answer.trim() || opts.default
}

/**
 * Single-choice selector (arrow-key `@inquirer/prompts` select). Returns the
 * chosen value, or `undefined` when not interactive.
 */
export async function promptSelect<T>(
  message: string,
  choices: Array<{ name: string; value: T; description?: string }>,
  gate: PromptGate = {},
): Promise<T | undefined> {
  if (!canPrompt(gate)) return undefined
  return ask(() => select({ message, choices }, promptContext()))
}

/**
 * Multi-choice selector (a styled `@inquirer/prompts` checkbox — space toggles,
 * enter confirms). Pre-check options with `checked: true`. Returns the chosen
 * values, or `undefined` when not interactive.
 */
export async function promptMultiSelect<T>(
  message: string,
  choices: Array<{ name: string; value: T; checked?: boolean; description?: string }>,
  gate: PromptGate = {},
): Promise<T[] | undefined> {
  if (!canPrompt(gate)) return undefined
  return ask(() => checkbox({ message, choices }, promptContext()))
}

/**
 * Single-choice selector over labeled values. Returns the chosen value, or
 * `null` when not interactive (callers decide how to fail). In a terminal the
 * user always picks one (Enter selects the highlighted option; Ctrl-C aborts
 * the command), so `null` only ever signals "nobody to ask".
 */
export async function selectFrom<T>(
  message: string,
  choices: Array<{ label: string; value: T }>,
  gate: PromptGate = {},
): Promise<T | null> {
  if (!canPrompt(gate)) return null
  return ask(() =>
    select(
      { message, choices: choices.map((c) => ({ name: c.label, value: c.value })) },
      promptContext(),
    ),
  )
}

/**
 * Prompt a passphrase without echoing it. `--json` / `--raw` do NOT disqualify
 * a passphrase — they shape the output, they do not mean the operator left — so
 * this reads on any interactive terminal that did not pass --ci / --no-prompt.
 * Everything else pipes it through ASTRALE_PASSPHRASE.
 */
export async function readPassphrase(
  message: string,
  opts: { minLength?: number } & PromptGate = {},
): Promise<string> {
  const env = opts.env ?? process.env
  const configured = env.ASTRALE_PASSPHRASE
  if (configured) return configured
  if (!canReadRequiredInput(opts)) {
    throw new Error(
      'Passphrase required but the terminal is not interactive. Pipe via ASTRALE_PASSPHRASE env var.',
    )
  }
  const answer = (await ask(() => password({ message, mask: true }, promptContext()))).trim()
  if (opts.minLength && answer.length < opts.minLength) {
    throw new Error(`Passphrase too short (min ${opts.minLength} chars)`)
  }
  return answer
}
