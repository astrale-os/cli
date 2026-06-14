import chalk from 'chalk'

import type { SetupContext, SetupStep, StepDetection, StepState } from './types'

import { readLocalStatus } from '../lib/local-status'
import { output } from '../lib/output'
import { panel } from '../lib/panel'
import { guiOrigin } from './util'

export type Detected = { step: SetupStep; detection: StepDetection }

const MARK: Record<StepState, () => string> = {
  satisfied: () => chalk.green('✔'),
  gap: () => chalk.yellow('○'),
  broken: () => chalk.red('✖'),
}

export function renderIntro(): void {
  console.log('')
  console.log(`${chalk.bold.cyan('astrale setup')} ${chalk.dim('· get connected and equipped')}`)
}

export function phaseHeader(n: number, title: string): void {
  console.log('')
  console.log(chalk.bold(`${n} · ${title}`))
}

/**
 * The read-only report for `--plan` and non-interactive runs: machine-readable
 * JSON (the agent's contract — each gap carries the command to fix it) or a
 * human checklist mirroring `astrale status`.
 */
export function renderPlan(detected: Detected[], ctx: SetupContext): void {
  const connected = detected
    .filter((d) => d.step.group === 'connect')
    .every((d) => d.detection.state === 'satisfied')

  if (ctx.machine) {
    output(
      {
        connected,
        steps: detected.map(({ step, detection }) => ({
          id: step.id,
          title: step.title,
          group: step.group,
          state: detection.state,
          summary: detection.summary,
          ...(detection.fixHint ? { fix: detection.fixHint } : {}),
        })),
      },
      ctx.opts,
    )
    return
  }

  console.log('')
  console.log(chalk.bold('Astrale setup — status'))
  for (const group of ['connect', 'equip'] as const) {
    const rows = detected.filter((d) => d.step.group === group)
    if (rows.length === 0) continue
    console.log('')
    console.log(chalk.bold(group === 'connect' ? 'Connect' : 'Equip'))
    for (const { detection } of rows) {
      const hint =
        detection.state === 'satisfied' || !detection.fixHint
          ? ''
          : `  ${chalk.dim(`→ ${detection.fixHint}`)}`
      console.log(`  ${MARK[detection.state]()} ${detection.summary}${hint}`)
    }
  }
  console.log('')
  console.log(
    chalk.dim(
      connected
        ? 'Connected. Run `astrale setup` to equip your workspace.'
        : 'Run `astrale setup` in a terminal to fix these interactively.',
    ),
  )
}

/** Closing recap: the active-instance hero (again) plus the obvious next moves. */
export async function renderFinale(): Promise<void> {
  const { instance } = await readLocalStatus()
  console.log('')
  if (instance) {
    console.log(
      panel(
        [
          `${chalk.green('✔')}  ${chalk.bold("You're all set")}`,
          '',
          `   ${chalk.cyan('Instance')}  ${chalk.bold(guiOrigin(instance.url))}`,
        ],
        { borderColor: chalk.green },
      ),
    )
  } else {
    console.log(
      chalk.yellow('⚠'),
      'Setup finished without an active instance — run `astrale setup` again when ready.',
    )
  }
  console.log('')
  console.log(chalk.bold('Next'))
  console.log(
    `  ${chalk.cyan('astrale call /:dist.astrale.ai:class.Echo:echo message=hello')}  ${chalk.dim('— smoke test')}`,
  )
  console.log(`  ${chalk.cyan('astrale browser')}  ${chalk.dim('— drive the GUI as your agent')}`)
  console.log(`  ${chalk.cyan('astrale --help')}  ${chalk.dim('— everything else')}`)
}
