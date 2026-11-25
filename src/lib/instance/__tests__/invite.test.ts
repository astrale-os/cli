import { expect, test } from 'bun:test'

import {
  acceptOperation,
  defaultName,
  inviteOnInstance,
  uuidv7,
  type ShellInvitationSteps,
} from '../invite'

function steps(created: boolean) {
  const calls: unknown[][] = []
  const fake: ShellInvitationSteps = {
    createUser: async (input) => {
      calls.push(['createUser', input])
      return { user: '@ada', created }
    },
    grantProfile: async (user, profile) => {
      calls.push(['grantProfile', user, profile])
    },
    sendInvitation: async (user) => {
      calls.push(['sendInvitation', user])
      return { execution: '@run' }
    },
  }
  return { calls, fake }
}

test('creates the account, gives it workspace.member, then starts Invitation.send', async () => {
  const { calls, fake } = steps(true)
  const invitation = await inviteOnInstance(fake, {
    instance: 'my-app',
    email: 'ada@example.com',
    operation: '0190f1c2-3b4d-7a1b-8c2d-0123456789ab',
  })
  expect(calls).toEqual([
    [
      'createUser',
      {
        operationId: '0190f1c2-3b4d-7a1b-8c2d-0123456789ab',
        email: 'ada@example.com',
        name: 'ada',
      },
    ],
    ['grantProfile', '@ada', 'member'],
    ['sendInvitation', '@ada'],
  ])
  expect(invitation).toEqual({
    instance: 'my-app',
    email: 'ada@example.com',
    user: '@ada',
    created: true,
    profile: 'member',
    execution: '@run',
    operation: '0190f1c2-3b4d-7a1b-8c2d-0123456789ab',
  })
})

test('gives a new account the profile asked for', async () => {
  const { calls, fake } = steps(true)
  await inviteOnInstance(fake, { instance: 'i', email: 'a@b.co', profile: 'admin', name: 'Ada' })
  expect(calls[0]?.[1]).toMatchObject({ name: 'Ada' })
  expect(calls[1]).toEqual(['grantProfile', '@ada', 'admin'])
})

test('leaves the profiles of an account that already existed', async () => {
  const { calls, fake } = steps(false)
  const invitation = await inviteOnInstance(fake, {
    instance: 'i',
    email: 'a@b.co',
    profile: 'admin',
  })
  expect(calls.map(([step]) => step)).toEqual(['createUser', 'sendInvitation'])
  expect(invitation.profile).toBeUndefined()
  expect(invitation.created).toBe(false)
})

test('a failed send leaves the operation to resume with', async () => {
  const { fake } = steps(true)
  const failing = { ...fake, sendInvitation: async () => Promise.reject(new Error('refused')) }
  await expect(inviteOnInstance(failing, { instance: 'i', email: 'a@b.co' })).rejects.toThrow(
    'refused',
  )
})

test('generates UUIDv7 that User.create admits, and admits only those', () => {
  const now = Date.UTC(2026, 10, 25)
  const id = uuidv7(now)
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  // The first 48 bits are the Unix time in milliseconds.
  expect(id.replace('-', '').slice(0, 12)).toBe(now.toString(16).padStart(12, '0'))
  expect(acceptOperation(id)).toBe(id)
  expect(() => acceptOperation(globalThis.crypto.randomUUID())).toThrow('UUIDv7')
})

test('names a new account after the local part of its email', () => {
  expect(defaultName('ada.lovelace@example.com')).toBe('ada.lovelace')
})
