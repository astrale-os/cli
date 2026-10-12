import { expect, test } from 'bun:test'
import { Command } from 'commander'

import { registerCommand } from '../../../program/registry'
import { installationCommand, installationCommands } from '../installation'

/** A repair session whose status announces `detail`; every Method sent to it is recorded. */
function repairSession(detail?: Readonly<Record<string, unknown>>) {
  const calls: unknown[][] = []
  const installation = {
    status: async (...args: unknown[]) => {
      calls.push(['status', ...args])
      return {
        id: 'existing-execution',
        state: 'waiting',
        ...(detail === undefined ? {} : { detail }),
      }
    },
    apply: async (...args: unknown[]) => void calls.push(['apply', ...args]),
    abort: async (...args: unknown[]) => void calls.push(['abort', ...args]),
  }
  const install = () => {
    throw new Error('Must not start an install')
  }
  return { calls, ctx: { session: { schema: { installation, install } } } as never }
}

test('apply sends the command the session awaits, with its validation, as the caller', async () => {
  const { calls, ctx } = repairSession({ phase: 'awaiting', command: 3 })
  const command = installationCommand('apply', 'existing-execution', {
    validationScope: 'full',
    validationCounts: 'exact',
  })
  expect(command.credential).toEqual({ principal: 'caller' })
  expect(await command.fn(ctx)).toEqual<unknown>({
    execution: 'existing-execution',
    signal: 'command:3',
    accepted: true,
  })
  expect(calls).toEqual([
    ['status', 'existing-execution'],
    ['apply', 'existing-execution', { index: 3, validation: { scope: 'full', counts: 'exact' } }],
  ])
})

test('abort stops the attempt the session runs', async () => {
  const { calls, ctx } = repairSession({
    phase: 'attempting',
    attempt: { number: 2, destination: 'target' },
  })
  expect(await installationCommand('abort', 'existing-execution', {}).fn(ctx)).toEqual<unknown>({
    execution: 'existing-execution',
    signal: 'abort:2',
    accepted: true,
  })
  expect(calls).toEqual([
    ['status', 'existing-execution'],
    ['abort', 'existing-execution', 2],
  ])
})

test('a session that announces no index is refused before any signal is sent', async () => {
  const cases = [
    ['apply', { phase: 'attempting', attempt: { number: 1, destination: 'target' } }],
    ['apply', { phase: 'draining' }],
    ['apply', undefined],
    ['abort', { phase: 'awaiting', command: 2 }],
  ] as const
  for (const [operation, detail] of cases) {
    const { calls, ctx } = repairSession(detail)
    const command = installationCommand(operation, 'existing-execution', { instance: 'app' })
    await expect(command.fn(ctx)).rejects.toMatchObject({
      code: operation === 'apply' ? 'SESSION_NOT_AWAITING' : 'SESSION_NO_ATTEMPT',
      hint: expect.stringContaining('astrale execution status existing-execution -i app'),
    })
    expect(calls).toEqual([['status', 'existing-execution']])
  }
})

test('admission rejects an invalid Execution ID before connecting', () => {
  expect(() => installationCommand('apply', '@not-an-id', {})).toThrow('Execution ID')
})

test('only apply and abort are registered, apply with its validation flags', async () => {
  expect(installationCommands.map(({ name }) => name)).toEqual(['apply', 'abort'])
  const program = new Command()
  let seen: unknown
  registerCommand(program, {
    ...installationCommands[0]!,
    action: async (id, opts) => {
      seen = { id, opts }
    },
  })
  await program.parseAsync(['apply', 'existing-execution', '--validation-scope', 'full'], {
    from: 'user',
  })
  expect(seen).toMatchObject({ id: 'existing-execution', opts: { validationScope: 'full' } })
  expect(
    installationCommands
      .flatMap(({ options }) => options ?? [])
      .some(({ flags }) => /--(command|attempt|force)\b/.test(flags)),
  ).toBe(false)
})
