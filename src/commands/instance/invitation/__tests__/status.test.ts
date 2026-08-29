import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { stripVTControlCharacters } from 'node:util'

import { createInvitationStatusCommand } from '../status'

const invitation = Object.freeze({
  id: '@invitation-node',
  email: 'person@example.com',
  state: 'accepted' as const,
  access: 'member' as const,
  instance: '@instance-node',
  invitedBy: '@owner',
  claimedBy: '@member',
  createdAt: '2026-08-28T10:00:00.000Z',
  acceptedAt: '2026-08-29T10:00:00.000Z',
})

let stdout = ''
let stderr = ''
let consoleLines: string[] = []
let originalStdout: typeof process.stdout.write
let originalStderr: typeof process.stderr.write
let originalConsoleLog: typeof console.log

beforeEach(() => {
  stdout = ''
  stderr = ''
  consoleLines = []
  originalStdout = process.stdout.write
  originalStderr = process.stderr.write
  originalConsoleLog = console.log
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write
  console.log = (...values: unknown[]) => consoleLines.push(values.map(String).join(' '))
})

afterEach(() => {
  process.stdout.write = originalStdout
  process.stderr.write = originalStderr
  console.log = originalConsoleLog
})

test('forwards the exact Invitation and Admin options and emits one machine value', async () => {
  const statusManagedInvitation = mock(async () => invitation)
  const command = createInvitationStatusCommand({ statusManagedInvitation })
  const action = command.action as (
    id: string,
    opts: { readonly json: boolean; readonly admin: string },
  ) => Promise<void>
  const options = { json: true, admin: 'beta-admin' }

  await action('@invitation-node', options)

  expect(statusManagedInvitation).toHaveBeenCalledTimes(1)
  expect(statusManagedInvitation).toHaveBeenCalledWith(options, '@invitation-node')
  expect(JSON.parse(stdout)).toEqual(invitation)
  expect(stdout).toBe(`${JSON.stringify(invitation, null, 2)}\n`)
})

test('prints one human headline and the useful durable lifecycle fields', async () => {
  const statusManagedInvitation = mock(async () => invitation)
  const command = createInvitationStatusCommand({ statusManagedInvitation })
  const action = command.action as (id: string, opts: Record<string, never>) => Promise<void>
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  const stderrDescriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY')
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
  Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true })
  try {
    await action('@invitation-node', {})
  } finally {
    if (stdoutDescriptor) Object.defineProperty(process.stdout, 'isTTY', stdoutDescriptor)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    if (stderrDescriptor) Object.defineProperty(process.stderr, 'isTTY', stderrDescriptor)
    else delete (process.stderr as { isTTY?: boolean }).isTTY
  }

  const rendered = stripVTControlCharacters(`${stderr}\n${consoleLines.join('\n')}`)
  expect(rendered.match(/Invitation accepted: person@example\.com/gu) ?? []).toHaveLength(1)
  expect(rendered).not.toContain('Invitation is accepted')
  expect(rendered).toContain('invitation: @invitation-node')
  expect(rendered).toContain('instance: @instance-node')
  expect(rendered).toContain('invited by: @owner')
  expect(rendered).toContain('claimed by: @member')
  expect(rendered).toContain('created: 2026-08-28T10:00:00.000Z')
  expect(rendered).toContain('accepted: 2026-08-29T10:00:00.000Z')
})
