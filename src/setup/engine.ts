import chalk from 'chalk'

import type { SetupContext, SetupOpts } from './types'

import { canPrompt } from '../lib/interactive'
import { readLocalStatus } from '../lib/local-status'
import { isMachine } from '../lib/output'
import { promptMultiSelect } from '../lib/prompt'
import { type Detected, phaseHeader, renderFinale, renderIntro, renderPlan } from './render'
import { ALL_STEPS, CONNECT_STEPS, EQUIP_STEPS } from './steps'

export type { SetupOpts } from './types'

/**
 * Run the setup reconciler. Two modes, one set of steps:
 *  - interactive (TTY): hand-hold each Connect step, then offer the unsatisfied
 *    Equip steps as a pre-checked multi-select.
 *  - --plan / non-interactive: detect everything and report (machine JSON or a
 *    human checklist), mutating nothing. This is the agent-facing contract.
 */
export async function runSetup(opts: SetupOpts, slug?: string): Promise<void> {
  const machine = isMachine(opts)
  const interactive = canPrompt(opts)
  const ctx: SetupContext = { interactive, machine, opts, slug }

  if (opts.plan || !interactive) {
    renderPlan(await detectAll(ctx), ctx)
    return
  }

  renderIntro()

  // Connect: required prerequisites, walked in order. Each ensure() re-detects
  // and is a no-op (a ✔ line) when already satisfied, so this resumes cleanly.
  phaseHeader(1, 'Connect to Astrale')
  for (const step of CONNECT_STEPS) {
    await step.ensure(ctx)
  }

  // Equip: optional. Offer only the unsatisfied ones, pre-checked.
  const equipGaps: Detected[] = []
  for (const step of EQUIP_STEPS) {
    const detection = await step.detect(ctx)
    if (detection.state !== 'satisfied') equipGaps.push({ step, detection })
  }
  if (equipGaps.length > 0) {
    phaseHeader(2, 'Equip your workspace & agents')
    const chosen =
      (await promptMultiSelect(
        'Select what to set up — space toggles, enter confirms:',
        equipGaps.map(({ step, detection }) => ({
          name: `${step.title} ${chalk.dim(`— ${detection.summary}`)}`,
          value: step.id,
          checked: true,
        })),
      )) ?? []
    for (const { step } of equipGaps) {
      if (chosen.includes(step.id)) await step.ensure(ctx)
    }
  }

  await renderFinale()
}

async function detectAll(ctx: SetupContext): Promise<Detected[]> {
  const detected: Detected[] = []
  for (const step of ALL_STEPS) {
    detected.push({ step, detection: await step.detect(ctx) })
  }
  return detected
}

/**
 * Should a bare `astrale` (no args, interactive terminal) launch setup instead
 * of printing help? Yes only when the user has no active instance — i.e. not
 * yet set up. A configured user gets help.
 */
export async function shouldAutostartSetup(): Promise<boolean> {
  try {
    return (await readLocalStatus()).instance === null
  } catch {
    return false
  }
}
