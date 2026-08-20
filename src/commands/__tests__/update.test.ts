import { describe, expect, mock, test } from 'bun:test'

import { cliStale, fetchNpmTargetVersion } from '../update'

describe('CLI update staleness', () => {
  test('trusts the release manifest for a script install without consulting npm latest', async () => {
    const fetchPackageVersion = mock(async () => '0.8.1-alpha.7')
    const result = await cliStale(
      { channel: 'beta' },
      {
        update: async () => ({
          status: 'up-to-date',
          currentVersion: '1.0.0-beta.0',
          latestVersion: '1.0.0-beta.0',
          channel: 'beta',
        }),
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

  test('uses the selected npm dist-tag only for package-managed installs', async () => {
    const result = await cliStale(
      { channel: 'beta' },
      {
        update: async () => {
          throw new Error('package managed')
        },
        fetchPackageVersion: async ({ channel }) => {
          expect(channel).toBe('beta')
          return '1.0.0-beta.0'
        },
      },
    )

    expect(result).toMatchObject({
      managed: true,
      latest: '1.0.0-beta.0',
      channel: 'npm',
    })
  })

  test('maps the stable channel to the npm latest dist-tag', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://registry.npmjs.org/@astrale-os/cli/latest')
      return Response.json({ version: '1.0.0' })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      expect(await fetchNpmTargetVersion({ channel: 'stable' })).toBe('1.0.0')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
