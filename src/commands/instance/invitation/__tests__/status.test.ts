import { expect, mock, test } from 'bun:test'

import { captureProcess, human } from '../../../__tests__/fixtures/process'
import { createInvitationStatusCommand } from '../status'

const io = captureProcess()
const invitation = Object.freeze({
  id: '@invitation-node',
  email: 'person@example.com',
  state: 'accepted' as const,
  access: 'member' as const,
  instance: '@instance-node',
  user: '@reserved-user',
  invitedBy: '@owner',
  claimedBy: '@member',
  createdAt: '2026-08-28T10:00:00.000Z',
  acceptedAt: '2026-08-29T10:00:00.000Z',
})

function command() {
  const statusManagedInvitation = mock(async () => invitation)
  const { action } = createInvitationStatusCommand({ statusManagedInvitation })
  return { statusManagedInvitation, action: action as (id: string, opts: object) => Promise<void> }
}

test('forwards the exact Invitation and Admin options and emits one machine value', async () => {
  const { statusManagedInvitation, action } = command()
  const options = { json: true, admin: 'beta-admin' }
  await action('@invitation-node', options)
  expect(statusManagedInvitation).toHaveBeenCalledWith(options, '@invitation-node')
  expect(io.stdout).toBe(`${JSON.stringify(invitation, null, 2)}\n`)
})

test('prints one human headline and the useful durable lifecycle fields', async () => {
  const { action } = command()
  const tty = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY')
  Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true })
  let shown: string
  try {
    shown = (await human(() => action('@invitation-node', {}))).all + io.stderr
  } finally {
    if (tty) Object.defineProperty(process.stderr, 'isTTY', tty)
    else delete (process.stderr as { isTTY?: boolean }).isTTY
  }
  expect(shown.match(/Invitation accepted: person@example\.com/gu) ?? []).toHaveLength(1)
  for (const line of [
    'invitation: @invitation-node',
    'instance: @instance-node',
    'user: @reserved-user',
    'invited by: @owner',
    'claimed by: @member',
    'created: 2026-08-28T10:00:00.000Z',
    'accepted: 2026-08-29T10:00:00.000Z',
  ])
    expect(shown).toContain(line)
})
