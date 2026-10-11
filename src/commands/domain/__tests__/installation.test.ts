import { expect, test } from 'bun:test'
import { Command } from 'commander'

import { registerCommand } from '../../../program/registry'
import { installationCommand, installationCommands } from '../installation'

test('observes or signals the exact existing Execution once, using caller authority', async () => {
  const calls: unknown[] = []
  const api = Object.fromEntries(
    ['status', 'result', 'apply', 'abort', 'cancel', 'resume'].map((method) => [
      method,
      async (...args: unknown[]) => {
        calls.push([method, ...args])
        return { state: 'waiting' }
      },
    ]),
  )
  const ctx = {
    session: {
      schema: {
        installation: api,
        install: () => {
          throw new Error('Must not start an install')
        },
      },
    },
  }
  const opts = {
    timeout: '5000',
    command: '3',
    attempt: '2',
    waitMs: '100',
    validationScope: 'full' as const,
    validationCounts: 'exact' as const,
  }
  for (const method of ['status', 'result', 'apply', 'abort', 'cancel', 'resume'] as const) {
    const command = installationCommand(method, 'existing-execution', opts)
    expect(command.credential).toEqual({ principal: 'caller' })
    const result = await command.fn(ctx as never)
    if (method === 'apply' || method === 'abort')
      expect(result).toMatchObject({ execution: 'existing-execution', accepted: true })
  }
  expect(calls).toEqual([
    ['status', 'existing-execution', { timeoutMs: 5000 }],
    ['result', 'existing-execution', { waitMs: 100 }, { timeoutMs: 5000 }],
    [
      'apply',
      'existing-execution',
      { index: 3, validation: { scope: 'full', counts: 'exact' } },
      { timeoutMs: 5000 },
    ],
    ['abort', 'existing-execution', 2, { timeoutMs: 5000 }],
    ['cancel', 'existing-execution', {}, { timeoutMs: 5000 }],
    ['resume', 'existing-execution', { timeoutMs: 5000 }],
  ])
})

test('admission rejects invalid IDs and missing, zero, fractional or unsafe signal indexes before connecting', () => {
  expect(() => installationCommand('status', '@not-an-id', {})).toThrow('Execution ID')
  for (const value of [undefined, '0', '-1', '1.5', '1e2', '9007199254740992']) {
    expect(() => installationCommand('apply', 'existing-execution', { command: value })).toThrow(
      '--command',
    )
    expect(() => installationCommand('abort', 'existing-execution', { attempt: value })).toThrow(
      '--attempt',
    )
  }
  expect(() => installationCommand('result', 'existing-execution', { waitMs: '-1' })).toThrow(
    '--wait-ms',
  )
})

test('Root repair command flags are registered without force or delete', async () => {
  const program = new Command()
  let seen: unknown
  const apply = installationCommands.find(({ name }) => name === 'apply')!
  registerCommand(program, {
    ...apply,
    action: async (id, opts) => {
      seen = { id, opts }
    },
  })
  await program.parseAsync(
    ['apply', 'existing-execution', '--command', '2', '--validation-scope', 'full'],
    { from: 'user' },
  )
  expect(seen).toMatchObject({
    id: 'existing-execution',
    opts: { command: '2', validationScope: 'full' },
  })
  expect(installationCommands.some(({ name }) => name === 'delete')).toBe(false)
  expect(
    installationCommands
      .flatMap(({ options }) => options ?? [])
      .some(({ flags }) => flags.includes('--force')),
  ).toBe(false)
})

test('uninstall observation uses its own decoder and never the install decoder', async () => {
  const command = installationCommand('result', 'existing-uninstall', { uninstall: true })
  const outcome = { kind: 'cancelled' as const }
  expect(
    await command.fn({
      session: {
        schema: {
          installation: {
            result: () => {
              throw Error('Wrong decoder')
            },
          },
          uninstallation: { result: async () => outcome },
        },
      },
    } as never),
  ).toBe(outcome)
  expect(() =>
    installationCommand('apply', 'existing-uninstall', { uninstall: true, command: '1' }),
  ).toThrow('no repair session')
})
