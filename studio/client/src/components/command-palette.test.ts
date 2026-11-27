import type { StudioSchemaBundle } from '@shared/contracts/schema'
import type { DomainSummary } from '@shared/contracts/workspace'

import { publishedDomainId } from '@shared/contracts/versions'
import { expect, test } from 'bun:test'

import { PaletteSearchIndexCache, paletteDomains } from './command-palette'

test('schema search reuses its index until a Domain render fingerprint changes', () => {
  const cache = new PaletteSearchIndexCache()
  const domains = [{ id: 'alpha', label: 'alpha.example' }]
  const first = { ir: null, renderFingerprint: 'sha-first' } as StudioSchemaBundle

  const index = cache.build(domains, [first])
  expect(cache.build(domains, [{ ...first, extractedAt: 'later' }])).toBe(index)
  expect(cache.build(domains, [{ ...first, renderFingerprint: 'sha-second' }])).not.toBe(index)
})

test('the Publication in view is searched first, named with its version', () => {
  const workspace = [{ id: 'alpha', origin: 'alpha.example' } as DomainSummary]
  const publication = publishedDomainId('issues.astrale.ai', '0.9.1')

  expect(paletteDomains(workspace, publication)).toEqual([
    { id: publication, label: 'issues.astrale.ai 0.9.1' },
    { id: 'alpha', label: 'alpha.example' },
  ])
  expect(paletteDomains(workspace, 'alpha')).toEqual([{ id: 'alpha', label: 'alpha.example' }])
  expect(paletteDomains(workspace, undefined)).toEqual([{ id: 'alpha', label: 'alpha.example' }])
})
