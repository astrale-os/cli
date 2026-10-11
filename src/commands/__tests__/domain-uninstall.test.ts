import { acceptOperationId, createSchema } from '@astrale-os/sdk/client/schema'
import { expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { uninstallCallInput, uninstallKernelCommand } from '../domain/uninstall'
import { runCli } from './fixtures/process'

test('sends the public Kernel uninstall request as the caller, Domains sorted and unique', () => {
  expect(
    uninstallCallInput(
      ['shared.example', 'app.example', 'shared.example'],
      'destructive',
      acceptOperationId('139137b5-af47-47ce-92b2-b64a2b0c63d7'),
    ),
  ).toEqual({
    operation: acceptOperationId('139137b5-af47-47ce-92b2-b64a2b0c63d7'),
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
  const receipt = { operation, transitions: [{ intent: { origin: 'app.example' } }] }
  const answer = {
    execution: 'execution-1',
    status: { state: 'completed', outcome: { kind: 'completed', value: receipt } },
    result: receipt,
  }
  const uninstall = async (input: unknown) => {
    request.push(input)
    return answer
  }
  expect(await command.fn({ session: { schema: { uninstall } } } as never)).toMatchObject({
    ...receipt,
    execution: 'execution-1',
    status: { state: 'completed' },
  })
  expect(request).toEqual([
    { operation, domains: ['app.example', 'shared.example'], data: { mode: 'destructive' } },
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

for (const state of ['pending', 'failed', 'cancelled'] as const) {
  test(`uninstall ${state} never presents an Execution reference as a receipt`, async () => {
    const command = uninstallKernelCommand(['app.example'], { yes: true })
    await expect(
      command.fn({
        session: {
          schema: {
            uninstall: async () => ({ execution: 'uninstall-execution', status: { state } }),
          },
        },
      } as never),
    ).rejects.toThrow(`Installation uninstall-execution is ${state}.`)
  })
}

test('published SDK decoder resolves durable uninstall before CLI reports a receipt', async () => {
  const operation = '139137b5-af47-47ce-92b2-b64a2b0c63d7'
  const result = {
    operation,
    transitions: [
      {
        intent: {
          transition: 'remove-app',
          operation,
          origin: 'app.example',
          previous: {
            origin: 'app.example',
            revision: 'sha256:' + 'c'.repeat(64),
            generation: 'sha256:' + 'a'.repeat(64),
          },
          generation: null,
        },
        phase: 'cutover',
        state: 'committed',
      },
    ],
  }
  const outcome = { kind: 'completed', value: result }
  const calls: string[] = []
  const schema = createSchema(
    async (call) => {
      calls.push(String(call.target))
      if (calls.length === 1)
        return { kind: 'execution', execution: 'uninstall-execution' } as never
      if (calls.length === 2) return { kind: 'value', value: outcome } as never
      return {
        kind: 'value',
        value: {
          id: 'uninstall-execution',
          function: 'uninstall-function',
          version: 'sha256:' + 'b'.repeat(64),
          state: 'completed',
          createdAt: '2026-10-11T18:00:00Z',
          outcome,
        },
      } as never
    },
    { maximumReleaseBytes: 1048576, maximumBundleBytes: 1048576, lifecycleTimeoutMs: 2000 },
  )
  const command = uninstallKernelCommand(['app.example'], { operation, yes: true })
  const received = await command.fn({ session: { schema } } as never)
  expect(received).toMatchObject({
    ...result,
    execution: 'uninstall-execution',
    status: { state: 'completed' },
  })
  expect(calls).toHaveLength(3)
  expect(calls[0]).toContain('function.uninstall')
})

test('uninstall retry quotes identity and target arguments literally', () => {
  const command = uninstallKernelCommand(['app.example'], {
    as: "O'Brien $USER",
    instance: 'qa staging',
    url: 'https://example.test/api?a=1&b=2',
    yes: true,
  })
  expect(command.recovery!.retry).toContain("-i 'qa staging'")
  expect(command.recovery!.retry).toContain("--url 'https://example.test/api?a=1&b=2'")
  if (process.platform !== 'win32')
    expect(command.recovery!.retry).toContain(`--as 'O'"'"'Brien $USER'`)
})
