import { expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { uninstallCallInput, uninstallKernelCommand } from '../domain/uninstall'
import { runCli } from './fixtures/process'

test('sends the public Kernel uninstall request as the caller, Domains sorted and unique', () => {
  expect(
    uninstallCallInput(['shared.example', 'app.example', 'shared.example'], 'destructive', 'op-2'),
  ).toEqual({
    operation: 'op-2',
    domains: ['app.example', 'shared.example'],
    data: { mode: 'destructive' },
  })
  expect(uninstallKernelCommand(['grc.example'], { yes: true }).credential).toEqual({
    principal: 'caller',
  })
  expect(() =>
    uninstallKernelCommand(['grc.example'], { operation: 'guessable-operation', yes: true }),
  ).toThrow('--operation must be a canonical lowercase UUIDv4.')
})

test('uses one explicit operation for submission and recovery', async () => {
  const operation = '139137b5-af47-47ce-92b2-b64a2b0c63d7'
  const request: unknown[] = []
  const command = uninstallKernelCommand(['app.example', 'shared.example'], {
    destructive: true,
    url: 'https://kernel.example.test/api',
    instance: 'staging',
    as: 'operator',
    operation,
    yes: true,
  })

  expect(command.recovery).toEqual({
    operation,
    retry:
      `astrale domain uninstall app.example shared.example --destructive ` +
      `--operation ${operation} --yes --url https://kernel.example.test/api ` +
      `-i staging --as operator`,
  })
  await command.fn({
    session: { call: async (input: unknown) => void request.push(input) },
  } as never)
  expect(request).toEqual([
    expect.objectContaining({
      input: {
        operation,
        domains: ['app.example', 'shared.example'],
        data: { mode: 'destructive' },
      },
    }),
  ])
})

test('requires --yes outside a TTY before connecting to a Kernel', async () => {
  const home = await mkdtemp(join(tmpdir(), 'astrale-domain-uninstall-'))
  const result = await runCli(home, ['domain', 'uninstall', 'grc.example', '--json'])
  expect(result.exitCode).toBe(1)
  expect(result.stdout).toBe('')
  expect(JSON.parse(result.stderr)).toMatchObject({
    error: 'CONFIRMATION_REQUIRED',
    message: 'Uninstalling Domain "grc.example" requires explicit confirmation.',
  })
})
