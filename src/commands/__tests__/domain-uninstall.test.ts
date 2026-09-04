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
    expect(stdout).toContain('does not cascade into unselected Domains')
  })
})
