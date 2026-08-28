import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  clearSkillOnboardingState,
  offerAstraleSkillInstallation,
  readSkillOnboardingState,
  skillInstallOfferDue,
} from '../skills/onboarding'

const DAY_MS = 24 * 60 * 60 * 1_000
const homes: string[] = []

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'astrale-skill-onboarding-'))
  homes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

describe('skill installation reminders', () => {
  test('a refusal at install schedules tomorrow, then seven days, then stops', async () => {
    const home = await makeHome()
    const installedAt = Date.UTC(2026, 7, 27, 12)

    const first = await offerAstraleSkillInstallation('install', {
      home,
      now: installedAt,
      interactive: true,
      prompt: async () => 'no',
    })
    expect(first).toMatchObject({
      status: 'declined',
      state: {
        updateDeclines: 0,
        reminderStage: 'next-day',
        nextPromptAt: new Date(installedAt + DAY_MS).toISOString(),
      },
    })

    let prompts = 0
    const early = await offerAstraleSkillInstallation('reminder', {
      home,
      now: installedAt + DAY_MS - 1,
      interactive: true,
      prompt: async () => {
        prompts += 1
        return 'no'
      },
    })
    expect(early).toEqual({ status: 'not-due' })
    expect(prompts).toBe(0)

    const firstReminderAt = installedAt + DAY_MS
    const second = await offerAstraleSkillInstallation('reminder', {
      home,
      now: firstReminderAt,
      interactive: true,
      prompt: async () => 'no',
    })
    expect(second).toMatchObject({
      status: 'declined',
      state: {
        reminderStage: 'seven-days',
        nextPromptAt: new Date(firstReminderAt + 7 * DAY_MS).toISOString(),
      },
    })

    const lastReminderAt = firstReminderAt + 7 * DAY_MS
    const third = await offerAstraleSkillInstallation('reminder', {
      home,
      now: lastReminderAt,
      interactive: true,
      prompt: async () => 'no',
    })
    expect(third).toMatchObject({ status: 'declined', state: { dismissed: true } })
    expect(
      skillInstallOfferDue('reminder', await readSkillOnboardingState({ home }), Infinity),
    ).toBe(false)
  })

  test('an update refusal resets the active reminder phase from the update time', async () => {
    const home = await makeHome()
    const installedAt = Date.UTC(2026, 7, 27, 12)
    await offerAstraleSkillInstallation('install', {
      home,
      now: installedAt,
      interactive: true,
      prompt: async () => 'no',
    })

    const beforeTomorrow = installedAt + 2 * 60 * 60 * 1_000
    const firstUpdate = await offerAstraleSkillInstallation('update', {
      home,
      now: beforeTomorrow,
      interactive: true,
      prompt: async () => 'no',
    })
    expect(firstUpdate).toMatchObject({
      status: 'declined',
      state: {
        updateDeclines: 1,
        reminderStage: 'next-day',
        nextPromptAt: new Date(beforeTomorrow + DAY_MS).toISOString(),
      },
    })

    const secondUpdate = await offerAstraleSkillInstallation('update', {
      home,
      now: beforeTomorrow + 1_000,
      interactive: true,
      prompt: async () => 'no',
    })
    expect(secondUpdate).toMatchObject({
      status: 'declined',
      state: { updateDeclines: 2, dismissed: true },
    })
  })

  test('an update keeps a seven-day reminder in the seven-day phase', async () => {
    const home = await makeHome()
    const installedAt = Date.UTC(2026, 7, 27, 12)
    await offerAstraleSkillInstallation('install', {
      home,
      now: installedAt,
      interactive: true,
      prompt: async () => 'no',
    })
    await offerAstraleSkillInstallation('reminder', {
      home,
      now: installedAt + DAY_MS,
      interactive: true,
      prompt: async () => 'no',
    })

    const updatedAt = installedAt + 2 * DAY_MS
    const update = await offerAstraleSkillInstallation('update', {
      home,
      now: updatedAt,
      interactive: true,
      prompt: async () => 'no',
    })
    expect(update).toMatchObject({
      status: 'declined',
      state: {
        updateDeclines: 1,
        reminderStage: 'seven-days',
        nextPromptAt: new Date(updatedAt + 7 * DAY_MS).toISOString(),
      },
    })
  })

  test('non-interactive and interrupted offers do not count as refusals', async () => {
    const home = await makeHome()
    expect(
      await offerAstraleSkillInstallation('update', {
        home,
        interactive: false,
        prompt: async () => 'no',
      }),
    ).toEqual({ status: 'not-interactive' })
    await expect(stat(join(home, 'skills-onboarding.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })

    await offerAstraleSkillInstallation('install', {
      home,
      interactive: true,
      prompt: async () => 'no',
    })
    const before = await readFile(join(home, 'skills-onboarding.json'), 'utf8')
    expect(
      await offerAstraleSkillInstallation('update', {
        home,
        interactive: false,
        prompt: async () => 'no',
      }),
    ).toEqual({ status: 'not-interactive' })
    expect(await readFile(join(home, 'skills-onboarding.json'), 'utf8')).toBe(before)

    await clearSkillOnboardingState({ home })

    expect(
      await offerAstraleSkillInstallation('install', {
        home,
        interactive: true,
        prompt: async () => undefined,
      }),
    ).toEqual({ status: 'not-interactive' })
    await expect(stat(join(home, 'skills-onboarding.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test('clearing successful onboarding removes only its reminder state', async () => {
    const home = await makeHome()
    await offerAstraleSkillInstallation('install', {
      home,
      interactive: true,
      prompt: async () => 'no',
    })
    expect(await readFile(join(home, 'skills-onboarding.json'), 'utf8')).toContain('nextPromptAt')

    await clearSkillOnboardingState({ home })
    await expect(stat(join(home, 'skills-onboarding.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
