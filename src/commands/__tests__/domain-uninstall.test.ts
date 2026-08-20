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
})
