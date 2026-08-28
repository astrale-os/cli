import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { uninstallCallInput } from '../domain/uninstall'

const cliRoot = join(import.meta.dir, '../../..')

describe('domain uninstall', () => {
  test('sends the public Kernel uninstall request', () => {
    expect(uninstallCallInput('grc.example', 'op-1')).toEqual({
      operation: 'op-1',
      origin: 'grc.example',
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

  test('states that uninstall never deletes business data', async () => {
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
    expect(stdout).toContain('Uninstall never deletes business data.')
    expect(stdout).toContain('business data still uses its schema')
  })
})
