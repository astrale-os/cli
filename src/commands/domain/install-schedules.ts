import chalk from 'chalk'

import type { ScheduleDeclaration, ScheduleEntry, ScheduleListing } from './install-precheck'

import { AstraleError } from '../../errors'
import { canPrompt, type PromptGate } from '../../lib/terminal/interactive'
import { promptYesNo } from '../../lib/terminal/prompt'

/**
 * A Domain's declared schedules start its callables on every Instance that installs it, acting as
 * that Domain (ADR-10). The Kernel neither asks for nor records a consent to them (decision 5), so
 * the install shows what each root will run and, when one is new or changed, asks once at a
 * terminal. Lighter than an issuer change: a yes/no question, and nothing refuses the install when
 * nobody can answer it, since the Kernel itself never would.
 */

/** A yes/no question at a terminal: the answer, or undefined when nobody can answer it. */
export type ScheduleQuestion = (message: string, gate: PromptGate) => Promise<boolean | undefined>

export const askAtTerminal: ScheduleQuestion = (message, gate) =>
  promptYesNo(message, { ...gate, default: false })

const MARK: Readonly<Record<ScheduleEntry['change'], string>> = {
  added: chalk.green('+'),
  changed: chalk.yellow('~'),
  removed: chalk.red('-'),
  unchanged: ' ',
}

/**
 * The lines that show one root's schedules on `instance`: one per schedule, marked `+` (new), `~`
 * (changed), `-` (removed) or blank, with its callable, cron text, zone and what changed.
 */
export function scheduleLines(listing: ScheduleListing, instance: string): readonly string[] {
  const rows = listing.schedules.map((entry) => {
    const shown = (entry.declared ?? entry.previous)!
    return {
      mark: MARK[entry.change],
      label: entry.name === 'default' ? entry.callable : `${entry.callable}/${entry.name}`,
      cron: shown.cron,
      zone: shown.timezone,
      note: scheduleNote(entry),
    }
  })
  const width = (column: 'label' | 'cron' | 'zone') =>
    Math.max(...rows.map((row) => row[column].length))
  const [label, cron, zone] = [width('label'), width('cron'), width('zone')]
  return [
    `Schedules on ${chalk.bold(instance)}, running as ${chalk.bold(listing.origin)}:`,
    ...rows.map((row) =>
      `  ${row.mark} ${row.label.padEnd(label)}   ${row.cron.padEnd(cron)}   ${row.zone.padEnd(zone)}   ${row.note}`.trimEnd(),
    ),
    ...(listing.active === 'unread'
      ? [
          chalk.dim(
            `  The installed schedules of ${listing.origin} are not readable here: each one is listed as new.`,
          ),
        ]
      : []),
  ]
}

function scheduleNote(entry: ScheduleEntry): string {
  if (entry.change === 'added') return chalk.green('new')
  if (entry.change === 'removed') return chalk.red('removed')
  if (entry.change === 'unchanged') return ''
  const before = entry.previous!
  const after = entry.declared!
  const changed = new Set(entry.changed)
  const notes: string[] = []
  if (changed.has('cron') || changed.has('timezone')) {
    notes.push(
      `was ${[
        ...(changed.has('cron') ? [before.cron] : []),
        ...(changed.has('timezone') ? [before.timezone] : []),
      ].join(' ')}`,
    )
  }
  if (changed.has('overlap')) notes.push(`overlap ${after.overlap}, was ${before.overlap}`)
  if (changed.has('maxDelay')) {
    notes.push(`maxDelay ${delayLabel(after.maxDelay)}, was ${delayLabel(before.maxDelay)}`)
  }
  if (changed.has('input')) notes.push('input changed')
  return chalk.yellow(notes.join('; '))
}

function delayLabel(seconds: ScheduleDeclaration['maxDelay']): string {
  if (seconds === undefined) return 'none'
  for (const [unit, size] of [
    ['d', 86_400],
    ['h', 3_600],
    ['m', 60],
  ] as const) {
    if (seconds % size === 0) return `${seconds / size}${unit}`
  }
  return `${seconds}s`
}

/** The install's schedules for a human, before it is sent: one block per root that declares any. */
export function presentSchedules(listings: readonly ScheduleListing[], instance: string): void {
  for (const listing of listings) {
    console.log('')
    for (const line of scheduleLines(listing, instance)) console.log(line)
  }
  if (listings.length > 0) console.log('')
}

/** What a confirmation of the install's schedules needs from its command. */
export interface ScheduleConfirmation {
  /** What the question names: `crm.acme.dev@1.5.0`, `crm.acme.dev`, or `these 2 Domains`. */
  readonly subject: string
  /** `--yes`: the question is not asked; the install is unchanged. */
  readonly yes: boolean
  readonly machine: boolean
  readonly gate: PromptGate
  readonly ask: ScheduleQuestion
}

/**
 * Ask once, at a terminal, before an install that adds or changes a schedule. Nothing is asked for
 * schedules that are only unchanged or removed, with --yes, in machine mode or without a terminal
 * (the listing, or `precheck.schedules` in --json, says what the install runs). A decline refuses
 * the install before it is sent.
 */
export async function confirmSchedules(
  listings: readonly ScheduleListing[],
  confirmation: ScheduleConfirmation,
): Promise<void> {
  const entries = listings.flatMap(({ schedules }) => schedules)
  const added = entries.filter(({ change }) => change === 'added').length
  const changed = entries.filter(({ change }) => change === 'changed').length
  if (added + changed === 0 || confirmation.yes || confirmation.machine) return
  if (!canPrompt(confirmation.gate)) return
  // The noun agrees with the last count: "1 new and 1 changed schedule", "2 new schedules".
  const counts = [
    ...(added > 0 ? [[added, 'new'] as const] : []),
    ...(changed > 0 ? [[changed, 'changed'] as const] : []),
  ]
  const counted = counts.map(([count, kind]) => `${count} ${kind}`).join(' and ')
  const noun = counts.at(-1)![0] === 1 ? 'schedule' : 'schedules'
  const question = `Install ${confirmation.subject} with ${counted} ${noun}?`
  if ((await confirmation.ask(question, confirmation.gate)) !== false) return
  throw new AstraleError(
    'SCHEDULES_NOT_CONFIRMED',
    `The install was not confirmed: it adds or changes schedules on this instance, and nothing was installed.`,
    'Install again and confirm, or pass --yes to install without this question.',
  )
}
