import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import pkg from '../../../package.json' with { type: 'json' }
import { cliStale } from '../update'

describe('CLI update staleness', () => {
  test('trusts the release manifest for a script install without consulting npm latest', async () => {
    const result = await cliStale(
      {},
      {
        update: async ({ channel }) => {
          expect(channel).toBe('beta')
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
    expect(stdout).toContain('Astrale skills skipped')
  })
})
