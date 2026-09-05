import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import pkg from '../../../package.json' with { type: 'json' }
import { cliStale } from '../update'

function interactiveEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', TERM: 'xterm-256color' }
  delete env.CI
  delete env.CONTINUOUS_INTEGRATION
  delete env.NO_SPINNER
  return env
}

async function runInTerminal(
  command: string[],
  cwd: string,
): Promise<{
  exitCode: number
  output: string
}> {
  const decoder = new TextDecoder()
  let output = ''
  let terminalExited!: () => void
  const terminalExit = new Promise<void>((resolve) => {
    terminalExited = resolve
  })

  const proc = Bun.spawn(command, {
    cwd,
    env: interactiveEnv(),
    terminal: {
      cols: 120,
      rows: 24,
      data: (_terminal, data) => {
        output += decoder.decode(data, { stream: true })
      },
      exit: () => {
        output += decoder.decode()
        terminalExited()
      },
    },
  })

  const [exitCode] = await Promise.all([proc.exited, terminalExit])
  proc.terminal?.close()
  return { exitCode, output }
}

describe('CLI update staleness', () => {
  test('trusts the release manifest for a script install without consulting npm latest', async () => {
    const result = await cliStale(
      {},
      {
        update: async ({ channel }) => {
          expect(channel).toBe('latest')
          return {
            status: 'up-to-date',
            currentVersion: '1.0.0-beta.0',
            latestVersion: '1.0.0-beta.0',
            channel: 'beta',
          }
        },
      },
    )

    expect(result).toEqual({
      stale: false,
      managed: false,
      current: '1.0.0-beta.0',
      latest: '1.0.0-beta.0',
      channel: 'beta',
    })
  })

  test('treats source/development builds as externally managed without an npm lookup', async () => {
    const result = await cliStale(
      { channel: 'canary' },
      {
        update: async () => ({
          status: 'managed',
          currentVersion: '1.0.0-beta.0',
          executable: '/opt/homebrew/bin/node',
        }),
      },
    )

    expect(result).toEqual({
      stale: false,
      managed: true,
      current: pkg.version,
    })
  })

  test('reports a same-version toolchain repair as stale without inventing a later version', async () => {
    const result = await cliStale(
      {},
      {
        update: async () => ({
          status: 'repair-available',
          currentVersion: '1.0.0-beta.0',
          channel: 'beta',
          bin: '/opt/astrale/bin/astrale',
        }),
      },
    )

    expect(result).toEqual({
      stale: true,
      managed: false,
      current: '1.0.0-beta.0',
      latest: '1.0.0-beta.0',
      channel: 'beta',
    })
  })

  test('does not misclassify a script update failure as package-managed', async () => {
    const result = await cliStale(
      {},
      {
        update: async () => {
          throw new Error('release endpoint unavailable')
        },
      },
    )

    expect(result).toMatchObject({
      stale: false,
      managed: false,
      error: 'release endpoint unavailable',
    })
  })
})

describe('CLI update application', () => {
  test('shows activity while updating in an interactive terminal', async () => {
    const root = join(import.meta.dir, '../../..')
    const result = await runInTerminal(
      [
        process.execPath,
        join(root, 'bin/astrale.ts'),
        'update',
        '--yes',
        '--no-skills',
        '--no-deps',
      ],
      root,
    )

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Checking and updating Astrale...')
    expect(result.output).toContain('UPDATE_PACKAGE_MANAGED')
  })

  test('keeps a durable status line when an operation outlives the spinner', async () => {
    const root = join(import.meta.dir, '../../..')
    const script = `
      const { withSpinner } = await import('./src/lib/log.ts')
      await withSpinner(
        'Slow operation',
        true,
        () => Bun.sleep(80),
        { longRunningText: 'Slow operation — still working', safetyMs: 10 },
      )
      console.log('complete')
    `
    const result = await runInTerminal([process.execPath, '-e', script], root)

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Slow operation — still working')
    expect(result.output).toContain('complete')
  })

  test('warns for a source runtime without blocking the remaining update axes', async () => {
    const root = join(import.meta.dir, '../../..')
    const proc = Bun.spawn(
      [
        process.execPath,
        join(root, 'bin/astrale.ts'),
        'update',
        '--yes',
        '--no-skills',
        '--no-deps',
      ],
      {
        cwd: root,
        env: { ...process.env, NO_COLOR: '1' },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exitCode).toBe(0)
    expect(stderr).toContain('UPDATE_PACKAGE_MANAGED')
    expect(stderr).toContain('cannot replace itself')
    expect(stderr).not.toContain('Checking and updating Astrale')
    expect(stdout).toContain('Astrale skills skipped')
  })
})
