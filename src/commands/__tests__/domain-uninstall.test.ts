import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import type { UninstallDependencies } from '../domain/uninstall'

import { uninstallDomain } from '../domain/uninstall'

const cliRoot = join(import.meta.dir, '../../..')

describe('domain uninstall', () => {
  test('sends the public Kernel call with an optional unchanged generation guard', async () => {
    const digest = `sha256:${'a'.repeat(64)}`
    const observed: unknown[] = []
    let operations = 0
    const dependencies: UninstallDependencies = {
      operation: () => `op-${++operations}`,
      async runKernelCommand(input) {
        await input.fn({
          session: {
            call: async (request: unknown) => {
              observed.push(request)
            },
          },
        } as never)
      },
    }

    await uninstallDomain('grc.example', { yes: true, json: true }, dependencies)
    await uninstallDomain(
      'grc.example',
      { yes: true, json: true, currentGeneration: digest },
      dependencies,
    )

    const calls = observed.map((request) => {
      const call = request as { target: unknown; input: unknown }
      expect(Object.keys(call).sort()).toEqual(['input', 'target'])
      return { target: String(call.target), input: call.input }
    })
    expect(calls).toEqual([
      {
        target: '/:kernel.astrale.ai:function.uninstall',
        input: {
          operation: 'op-1',
          origin: 'grc.example',
        },
      },
      {
        target: '/:kernel.astrale.ai:function.uninstall',
        input: {
          operation: 'op-2',
          origin: 'grc.example',
          currentGeneration: digest,
        },
      },
    ])
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
    expect(stdout).toContain('--current-generation <digest>')
  })
})
