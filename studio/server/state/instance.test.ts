import { describe, expect, test } from 'bun:test'

import { schemaHashOf } from '../introspect/hash'
import {
  installedBundleRootHash,
  installedDomainCommand,
  installedDomainProbeResult,
} from './instance'

describe('installed Domain introspection', () => {
  test('uses the public bundle introspection command for the selected instance', () => {
    expect(installedDomainCommand('issues.astrale.ai', 'staging')).toEqual([
      'astrale',
      'introspect',
      'issues.astrale.ai',
      '--bundle',
      '--json',
      '-i',
      'staging',
    ])
  })

  test('hashes the installed Bundle root with the same deterministic hash as local schema', () => {
    const root = {
      version: 'v1',
      domain: 'issues.astrale.ai',
      classes: { Issue: { properties: { title: { type: 'string' } } } },
    }
    const probe = installedDomainProbeResult(
      JSON.stringify({
        state: 'ready',
        bundle: { format: 'astrale.dsl.bundle', version: 'v1', root, closure: [] },
      }),
      '',
      0,
    )
    expect(probe.state).toBe('installed')
    expect(installedBundleRootHash(probe)).toBe(schemaHashOf(root))
  })

  test('does not mistake the removed Domain Node shape for installation introspection', () => {
    expect(
      installedDomainProbeResult(
        JSON.stringify({ path: '/issues.astrale.ai', props: { schema: '{"domain":"old"}' } }),
        '',
        0,
      ),
    ).toEqual({ state: 'unknown', root: null })
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
    ).toEqual({ state: 'not-installed', root: null })
  })
})
