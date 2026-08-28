import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { paths } from '../../state'
import { atomicWrite, withFileLock } from '../../state/files'
import { promptSelect } from '../prompt'

const STATE_VERSION = 1
const DAY_MS = 24 * 60 * 60 * 1_000
const UPDATE_DECLINE_LIMIT = 2

export const SKILL_CONFIGURE_COMMAND = 'astrale skills configure'

export type SkillOnboardingSource = 'install' | 'reminder' | 'update'
export type SkillReminderStage = 'next-day' | 'seven-days'

export type SkillOnboardingState = {
  version: typeof STATE_VERSION
  updateDeclines: number
  reminderStage?: SkillReminderStage
  nextPromptAt?: string
  dismissed?: true
}

export type SkillInstallOffer =
  | { status: 'accepted' }
  | { status: 'declined'; state: SkillOnboardingState }
  | { status: 'not-due' | 'not-interactive' | 'suppressed' }

type StateOptions = {
  home?: string
  now?: number
}

type OfferOptions = StateOptions & {
  interactive?: boolean
  prompt?: () => Promise<'yes' | 'no' | undefined>
}

function statePath(home: string): string {
  return join(home, 'skills-onboarding.json')
}

function lockPath(home: string): string {
  return join(home, 'locks', 'skills-onboarding.lock')
}

function emptyState(): SkillOnboardingState {
  return { version: STATE_VERSION, updateDeclines: 0 }
}

function parseState(value: unknown): SkillOnboardingState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const state = value as Partial<SkillOnboardingState>
  if (
    state.version !== STATE_VERSION ||
    !Number.isSafeInteger(state.updateDeclines) ||
    (state.updateDeclines ?? -1) < 0 ||
    (state.updateDeclines ?? 0) > UPDATE_DECLINE_LIMIT ||
    (state.reminderStage !== undefined &&
      state.reminderStage !== 'next-day' &&
      state.reminderStage !== 'seven-days') ||
    (state.nextPromptAt !== undefined &&
      (typeof state.nextPromptAt !== 'string' ||
        !Number.isFinite(Date.parse(state.nextPromptAt)))) ||
    (state.dismissed !== undefined && state.dismissed !== true)
  ) {
    return undefined
  }
  if (state.dismissed) {
    return {
      version: STATE_VERSION,
      updateDeclines: state.updateDeclines ?? 0,
      dismissed: true,
    }
  }
  if ((state.reminderStage === undefined) !== (state.nextPromptAt === undefined)) return undefined
  return {
    version: STATE_VERSION,
    updateDeclines: state.updateDeclines ?? 0,
    ...(state.reminderStage ? { reminderStage: state.reminderStage } : {}),
    ...(state.nextPromptAt ? { nextPromptAt: state.nextPromptAt } : {}),
  }
}

export async function readSkillOnboardingState(
  options: Pick<StateOptions, 'home'> = {},
): Promise<SkillOnboardingState> {
  try {
    const raw = await readFile(statePath(options.home ?? paths.home), 'utf8')
    return parseState(JSON.parse(raw)) ?? emptyState()
  } catch {
    return emptyState()
  }
}

async function transitionSkillOnboardingState(
  options: Pick<StateOptions, 'home'>,
  transition: (state: SkillOnboardingState) => SkillOnboardingState,
): Promise<SkillOnboardingState> {
  const home = options.home ?? paths.home
  return withFileLock(lockPath(home), async () => {
    const next = transition(await readSkillOnboardingState({ home }))
    await atomicWrite(statePath(home), `${JSON.stringify(next, null, 2)}\n`)
    return next
  })
}

export async function clearSkillOnboardingState(
  options: Pick<StateOptions, 'home'> = {},
): Promise<void> {
  const home = options.home ?? paths.home
  await withFileLock(lockPath(home), () => rm(statePath(home), { force: true }))
}

export function skillInstallOfferDue(
  source: SkillOnboardingSource,
  state: SkillOnboardingState,
  now = Date.now(),
): boolean {
  if (state.dismissed) return false
  if (source !== 'reminder') return true
  if (!state.nextPromptAt) return false
  return Date.parse(state.nextPromptAt) <= now
}

export async function recordSkillInstallDecline(
  source: SkillOnboardingSource,
  options: StateOptions = {},
): Promise<SkillOnboardingState> {
  const now = options.now ?? Date.now()
  return transitionSkillOnboardingState(options, (state) => {
    if (state.dismissed) return state

    if (source === 'reminder' && state.reminderStage === 'seven-days') {
      return { version: STATE_VERSION, updateDeclines: state.updateDeclines, dismissed: true }
    }

    const updateDeclines =
      source === 'update'
        ? Math.min(UPDATE_DECLINE_LIMIT, state.updateDeclines + 1)
        : state.updateDeclines
    if (updateDeclines >= UPDATE_DECLINE_LIMIT) {
      return { version: STATE_VERSION, updateDeclines, dismissed: true }
    }

    const reminderStage: SkillReminderStage =
      source === 'reminder' ? 'seven-days' : (state.reminderStage ?? 'next-day')
    const delay = reminderStage === 'next-day' ? DAY_MS : 7 * DAY_MS
    return {
      version: STATE_VERSION,
      updateDeclines,
      reminderStage,
      nextPromptAt: new Date(now + delay).toISOString(),
    }
  })
}

function defaultInteractive(): boolean {
  return (
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    !process.env.CI &&
    !process.env.CONTINUOUS_INTEGRATION &&
    !process.argv.includes('--ci') &&
    !process.argv.includes('--no-prompt') &&
    !process.argv.includes('--json') &&
    !process.argv.includes('--raw')
  )
}

async function defaultInstallPrompt(): Promise<'yes' | 'no' | undefined> {
  return promptSelect('Install Astrale skills?', [
    { name: 'Yes', value: 'yes' as const },
    { name: 'No', value: 'no' as const },
  ])
}

export async function offerAstraleSkillInstallation(
  source: SkillOnboardingSource,
  options: OfferOptions = {},
): Promise<SkillInstallOffer> {
  const state = await readSkillOnboardingState(options)
  if (state.dismissed) return { status: 'suppressed' }
  if (!skillInstallOfferDue(source, state, options.now)) return { status: 'not-due' }
  if (!(options.interactive ?? defaultInteractive())) return { status: 'not-interactive' }

  const answer = await (options.prompt ?? defaultInstallPrompt)()
  if (answer === undefined) return { status: 'not-interactive' }
  if (answer === 'yes') return { status: 'accepted' }
  return {
    status: 'declined',
    state: await recordSkillInstallDecline(source, options),
  }
}
