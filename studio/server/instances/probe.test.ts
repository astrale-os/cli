import { describe, expect, test } from 'bun:test'

import { installedDomainCommand, installedDomainProbeResult } from './probe'

describe('installed Domain introspection', () => {
  test('uses the public bundle introspection command for the selected instance', () => {
    const descriptor = JSON.stringify({
      version: 1,
      executable: '/usr/local/bin/bun',
      args: ['/workspace/cli/bin/astrale.ts'],
    })
    expect(installedDomainCommand('issues.astrale.ai', 'staging', descriptor)).toEqual([
      '/usr/local/bin/bun',
      '/workspace/cli/bin/astrale.ts',
      'introspect',
      'issues.astrale.ai',
      '--bundle',
      '--json',
      '-i',
      'staging',
    ])
  })

  test('retains the complete installed Bundle for cohort SDK admission', () => {
    const root = {
      version: 'v1',
      domain: 'issues.astrale.ai',
      classes: { Issue: { properties: { title: { type: 'string' } } } },
    }
    expect(
      installedDomainProbeResult(
        JSON.stringify({
          state: 'ready',
          bundle: { format: 'astrale.dsl.bundle', version: 'v1', root, closure: [] },
        }),
        '',
        0,
      ),
    ).toEqual({
      state: 'installed',
      bundle: { format: 'astrale.dsl.bundle', version: 'v1', root, closure: [] },
    })
  })

  test('does not mistake the removed Domain Node shape for installation introspection', () => {
    expect(
      installedDomainProbeResult(
        JSON.stringify({ path: '/issues.astrale.ai', props: { schema: '{"domain":"old"}' } }),
        '',
        0,
      ),
    ).toEqual({ state: 'unknown', bundle: null })
  })

  test('recognizes the current CLI not-installed diagnostic', () => {
    expect(
      installedDomainProbeResult(
        '',
        JSON.stringify({
          error: 'DOMAIN_NOT_INSTALLED',
          message: 'Domain issues.astrale.ai is not installed on this Kernel.',
        }),
        1,
      ),
    ).toEqual({ state: 'not-installed', bundle: null })
  })
})
