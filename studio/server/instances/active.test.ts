import { describe, expect, test } from 'bun:test'

import { instancesState } from './active'

/** `instance list --admin-only --json` for one caller: an owned Instance, and one it only uses. */
const managed = {
  active: 'mine',
  instances: [
    {
      id: '@owned',
      slug: 'mine',
      url: 'https://mine.eu.astrale.ai',
      issuer: 'https://mine.eu.astrale.ai/api',
      state: 'ready',
      owned: true,
    },
    {
      id: '@member',
      slug: 'team',
      url: 'https://team.eu.astrale.ai',
      issuer: 'https://team.eu.astrale.ai/api',
      state: 'ready',
      owned: false,
    },
  ],
}

describe('Studio instance ownership', () => {
  test('a bookmark is owned through the Admin Instance serving its Kernel, whatever its name', () => {
    const local = {
      active: 'work',
      bookmarks: [
        // `instance use` records the region-routed root as its `/api` Kernel.
        { name: 'work', url: 'https://mine.eu.astrale.ai/api', issuer: null, active: true },
        { name: 'team', url: 'https://team.eu.astrale.ai/api/', issuer: null },
        { name: 'dev', url: 'http://127.0.0.1:7200', issuer: null },
      ],
    }
    expect(instancesState(local, managed, 'work')).toEqual({
      active: 'work',
      instances: [
        {
          name: 'work',
          url: 'https://mine.eu.astrale.ai/api',
          active: true,
          kind: 'bookmark',
          owned: true,
        },
        {
          name: 'team',
          url: 'https://team.eu.astrale.ai/api/',
          active: false,
          kind: 'bookmark',
          owned: false,
          reason: 'Not owner',
        },
        // A local dev Kernel stays listed, not selectable.
        {
          name: 'dev',
          url: 'http://127.0.0.1:7200',
          active: false,
          kind: 'bookmark',
          owned: false,
          reason: 'Not an Admin instance',
        },
      ],
    })
  })

  test('an Admin Instance without a bookmark is listed with its own ownership', () => {
    expect(instancesState({ active: '', bookmarks: [] }, managed, null).instances).toEqual([
      {
        name: 'mine',
        url: 'https://mine.eu.astrale.ai',
        active: false,
        kind: 'managed',
        owned: true,
      },
      {
        name: 'team',
        url: 'https://team.eu.astrale.ai',
        active: false,
        kind: 'managed',
        owned: false,
        reason: 'Not owner',
      },
    ])
  })

  test('nothing is owned when Admin could not decide it', () => {
    const local = {
      active: 'work',
      bookmarks: [{ name: 'work', url: 'https://mine.eu.astrale.ai' }],
    }
    expect(instancesState(local, undefined, 'work').instances).toEqual([
      {
        name: 'work',
        url: 'https://mine.eu.astrale.ai',
        active: true,
        kind: 'bookmark',
        owned: false,
        reason: 'Ownership unknown: Admin unavailable',
      },
    ])
    // An Admin output that carries no decision is not one either.
    const undecided = {
      instances: [{ slug: 'mine', url: 'https://mine.eu.astrale.ai', state: 'ready' }],
    }
    expect(instancesState(local, undecided, 'work').instances[0]).toMatchObject({
      owned: false,
      reason: 'Ownership unknown',
    })
  })

  test('two Admin Instances claiming one Kernel own nothing, and a retired one claims none', () => {
    const local = { bookmarks: [{ name: 'work', url: 'https://mine.eu.astrale.ai/api' }] }
    const twice = {
      instances: [managed.instances[0], { ...managed.instances[0], id: '@again', slug: 'again' }],
    }
    expect(instancesState(local, twice, null).instances[0]).toMatchObject({
      owned: false,
      reason: 'Ambiguous Admin instance',
    })
    const retired = {
      instances: [managed.instances[0], { ...managed.instances[0], slug: 'old', state: 'deleted' }],
    }
    expect(instancesState(local, retired, null).instances[0]).toMatchObject({ owned: true })
  })

  test('an active instance set from a terminal and unknown to both lists is shown, not owned', () => {
    expect(instancesState({ bookmarks: [] }, managed, 'elsewhere').instances[0]).toEqual({
      name: 'elsewhere',
      url: '',
      active: true,
      kind: 'bookmark',
      owned: false,
      reason: 'Ownership unknown',
    })
  })
})
