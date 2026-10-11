import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  clearSkillOnboardingState,
  offerAstraleSkillInstallation,
  type SkillOnboardingSource,
} from '../skills/onboarding'

const DAY = 24 * 60 * 60 * 1_000
const T0 = Date.UTC(2026, 7, 27, 12)
const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'astrale-skill-onboarding-'))
  homes.push(home)
  return home
}

function offer(
  home: string,
  source: SkillOnboardingSource,
  now: number,
  answer: 'yes' | 'no' | 'interrupted' = 'no',
  interactive = true,
) {
  const prompt = async () => (answer === 'interrupted' ? undefined : answer)
  return offerAstraleSkillInstallation(source, { home, now, interactive, prompt })
}

async function hasState(home: string): Promise<boolean> {
  return (await stat(join(home, 'skills-onboarding.json')).catch(() => null)) !== null
}

describe('skill installation reminders', () => {
  test('a refusal at install reminds the next day, then after seven days, then stops', async () => {
    const home = await makeHome()

    expect(await offer(home, 'install', T0)).toMatchObject({
      state: { reminderStage: 'next-day', nextPromptAt: new Date(T0 + DAY).toISOString() },
    })
    expect(await offer(home, 'reminder', T0 + DAY - 1)).toEqual({ status: 'not-due' })
    expect(await offer(home, 'reminder', T0 + DAY)).toMatchObject({
      state: { reminderStage: 'seven-days', nextPromptAt: new Date(T0 + 8 * DAY).toISOString() },
    })
    expect(await offer(home, 'reminder', T0 + 8 * DAY)).toMatchObject({
      state: { dismissed: true },
    })
    expect(await offer(home, 'install', T0 + 100 * DAY)).toEqual({ status: 'suppressed' })
  })

  test('an update refusal restarts the current phase from the update; two dismiss', async () => {
    const home = await makeHome()
    await offer(home, 'install', T0)
    await offer(home, 'reminder', T0 + DAY)

    expect(await offer(home, 'update', T0 + 2 * DAY)).toMatchObject({
      state: {
        updateDeclines: 1,
        reminderStage: 'seven-days',
        nextPromptAt: new Date(T0 + 9 * DAY).toISOString(),
      },
    })
    expect(await offer(home, 'update', T0 + 2 * DAY + 1)).toMatchObject({
      state: { updateDeclines: 2, dismissed: true },
    })
  })

  test('neither a non-interactive nor an interrupted offer counts as a refusal', async () => {
    const home = await makeHome()
    expect(await offer(home, 'update', T0, 'no', false)).toEqual({ status: 'not-interactive' })
    expect(await offer(home, 'install', T0, 'interrupted')).toEqual({ status: 'not-interactive' })
    expect(await hasState(home)).toBe(false)

    await offer(home, 'install', T0)
    await clearSkillOnboardingState({ home })
    expect(await hasState(home)).toBe(false)
  })
})
