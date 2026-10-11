import type { DomainSummary, StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { PaletteSearchIndexCache } from './command-palette'

test('schema search reuses its index until a Domain render fingerprint changes', () => {
  const cache = new PaletteSearchIndexCache()
  const domains = [{ id: 'alpha', origin: 'alpha.example' } as DomainSummary]
  const first = { ir: null, renderFingerprint: 'sha-first' } as StudioSchemaBundle

  const index = cache.build(domains, [first])
  expect(cache.build(domains, [{ ...first, extractedAt: 'later' }])).toBe(index)
  expect(cache.build(domains, [{ ...first, renderFingerprint: 'sha-second' }])).not.toBe(index)
})
