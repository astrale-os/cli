import { describe, expect, mock, test } from 'bun:test'

import { cliStale, fetchNpmTargetVersion } from '../update'

describe('CLI update staleness', () => {
  test('trusts the release manifest for a script install without consulting npm latest', async () => {
    const fetchPackageVersion = mock(async () => '0.8.1-alpha.7')
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
        fetchPackageVersion,
      },
    )

    expect(result).toEqual({
      stale: false,
      managed: false,
      current: '1.0.0-beta.0',
      latest: '1.0.0-beta.0',
      channel: 'beta',
    })
    expect(fetchPackageVersion).not.toHaveBeenCalled()
  })

  test('uses an explicit npm dist-tag only for package-managed installs', async () => {
    const result = await cliStale(
      { channel: 'canary' },
      {
        update: async () => ({
          status: 'managed',
          currentVersion: '1.0.0-beta.0',
          executable: '/opt/homebrew/bin/node',
        }),
        fetchPackageVersion: async ({ channel }) => {
          expect(channel).toBe('canary')
          return '1.0.0-canary.0'
        },
      },
    )

    expect(result).toMatchObject({
      managed: true,
      latest: '1.0.0-canary.0',
      channel: 'npm',
    })
  })

  test('does not misclassify a script update failure as package-managed', async () => {
    const fetchPackageVersion = mock(async () => '9.9.9')
    const result = await cliStale(
      {},
      {
        update: async () => {
          throw new Error('release endpoint unavailable')
        },
        fetchPackageVersion,
      },
    )

    expect(result).toMatchObject({
      stale: false,
      managed: false,
      error: 'release endpoint unavailable',
    })
    expect(fetchPackageVersion).not.toHaveBeenCalled()
  })

  test('maps the default to beta and the stable channel to npm latest', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const target = String(input).split('/').at(-1)
      return Response.json({ version: target === 'beta' ? '1.0.0-beta.0' : '1.0.0' })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      expect(await fetchNpmTargetVersion({})).toBe('1.0.0-beta.0')
      expect(await fetchNpmTargetVersion({ channel: 'stable' })).toBe('1.0.0')
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        'https://registry.npmjs.org/@astrale-os/cli/beta',
        'https://registry.npmjs.org/@astrale-os/cli/latest',
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
