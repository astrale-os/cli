import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { uninstallCallInput, uninstallKernelCommand } from '../domain/uninstall'

const cliRoot = join(import.meta.dir, '../../..')

describe('domain uninstall', () => {
  test('sends the public Kernel uninstall request', () => {
    expect(uninstallCallInput(['grc.example'], 'safe', 'op-1')).toEqual({
      operation: 'op-1',
      domains: ['grc.example'],
      data: { mode: 'safe' },
    })
    expect(
      uninstallCallInput(
        ['shared.example', 'app.example', 'shared.example'],
        'destructive',
        'op-2',
      ),
    ).toEqual({
      operation: 'op-2',
      domains: ['app.example', 'shared.example'],
      data: { mode: 'destructive' },
    })
  })

  test('preserves the caller principal for the lifecycle syscall', () => {
    expect(uninstallKernelCommand(['grc.example'], { yes: true }).credential).toEqual({
      principal: 'caller',
    })
  })

  test('uses one explicit operation for submission and recovery', async () => {
    const operation = '139137b5-af47-47ce-92b2-b64a2b0c63d7'
    const request: unknown[] = []
    const command = uninstallKernelCommand(['app.example', 'shared.example'], {
      destructive: true,
      instance: 'staging',
      as: 'operator',
      operation,
      yes: true,
    })

    expect(command.recovery).toEqual({
      operation,
      retry:
        `astrale domain uninstall app.example shared.example --destructive ` +
        `--operation ${operation} --yes -i staging --as operator`,
    })
    await command.fn({
      session: {
        call: async (input: unknown) => {
          request.push(input)
          return { operation, transitions: [] }
        },
      },
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

  test('rejects a non-UUID retry operation before creating a command', () => {
    expect(() =>
      uninstallKernelCommand(['grc.example'], {
        operation: 'guessable-operation',
        yes: true,
      }),
    ).toThrow('--operation must be a canonical lowercase UUIDv4.')
  })

  test('requires --yes outside a TTY before connecting to a Kernel', async () => {
    const proc = Bun.spawn({
      cmd: ['bun', join(cliRoot, 'bin/astrale.ts'), 'domain', 'uninstall', 'grc.example', '--json'],
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(JSON.parse(stderr)).toMatchObject({
      error: 'CONFIRMATION_REQUIRED',
      message: 'Uninstalling Domain "grc.example" requires explicit confirmation.',
    })
  })

  test('explains safe and destructive multi-Domain semantics', async () => {
    const proc = Bun.spawn({
      cmd: ['bun', join(cliRoot, 'bin/astrale.ts'), 'domain', 'uninstall', '--help'],
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    expect(stdout).toContain('<origins...>')
    expect(stdout).toContain('Safe mode is the default and never deletes application data.')
    expect(stdout).toContain('--destructive')
    expect(stdout).toContain('--operation <uuid>')
    expect(stdout).toContain('does not cascade into unselected Domains')
  })
})
