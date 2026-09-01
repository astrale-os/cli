import type { AdminTargetCommandOpts } from '../lib/admin-target'

/**
 * The setup reconciler models onboarding as a list of small, independent steps,
 * each able to (a) `detect` its state without side effects and (b) `ensure` its
 * state interactively, taking the user by the hand. `detect` powers the
 * read-only plan + checklist (and the agent-facing `--plan` JSON); `ensure` is
 * the hand-held fix. Both are idempotent — re-running setup when everything is
 * already satisfied just prints a row of ✔.
 */

export type StepState = 'satisfied' | 'gap' | 'broken'

export type StepDetection = {
  state: StepState
  /** One-line status for the checklist (no symbol — the renderer adds it). */
  summary: string
  /** Optional dim detail line. */
  detail?: string
  /** The granular command an agent (or a human) would run to close the gap. */
  fixHint?: string
}

export type StepOutcome = 'fixed' | 'unchanged' | 'skipped' | 'failed'

export type SetupOpts = AdminTargetCommandOpts & {
  /** Read-only: print the plan and exit without mutating anything. */
  plan?: boolean
  json?: boolean
  raw?: boolean
  // Programmatic opt-out for callers that drive this command as a function.
  // The matching CLI flags are read from argv by `canPrompt` — Commander
  // keeps root options out of a subcommand's action arguments.
  ci?: boolean
  noPrompt?: boolean
  // Threaded into admin-kernel calls (provisioning, instance listing).
  as?: string
  creds?: string
  timeout?: string
  debug?: boolean
}

export type SetupContext = {
  /** `canPrompt(opts)`: a human is there to answer — ok to prompt and mutate. */
  interactive: boolean
  /** isMachine(opts): --json / --raw or piped — structured output, no spinners. */
  machine: boolean
  opts: SetupOpts
  /** Instance slug hint from the positional arg, used when provisioning. */
  slug?: string
}

export type StepGroup = 'connect' | 'equip'

export type SetupStep = {
  id: string
  title: string
  group: StepGroup
  /** Read-only probe for the plan + checklist. Never prompts, never mutates. */
  detect: (ctx: SetupContext) => Promise<StepDetection>
  /** Interactive, idempotent hand-holding. May print rich output (e.g. a hero). */
  ensure: (ctx: SetupContext) => Promise<StepOutcome>
}
