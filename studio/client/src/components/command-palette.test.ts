import type { DomainSummary, StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { PaletteSearchIndexCache, paletteBundleQuery, paletteLoadState } from './command-palette'

const domain = (id: string): DomainSummary => ({
  id,
  origin: `${id}.example`,
  path: `/tmp/${id}`,
  schemaDir: 'schema',
  depsInstalled: true,
  hasGit: true,
  configFile: `/tmp/${id}/astrale.config.ts`,
})

test('schema search does not request Domain bundles while its palette is closed', () => {
  expect(paletteBundleQuery('alpha', false).enabled).toBe(false)
  expect(paletteBundleQuery('alpha', true).enabled).toBe(true)
})

test('schema search reports progressive per-Domain loading', () => {
  const domains = [domain('ready'), domain('waiting'), domain('broken')]
  const result = paletteLoadState(domains, [
    { data: {} as StudioSchemaBundle, isError: false },
    { isError: false },
    { isError: true },
  ])

  expect(result.loaded.map(({ id }) => id)).toEqual(['ready'])
  expect(result.pending.map(({ id }) => id)).toEqual(['waiting'])
  expect(result.failed.map(({ id }) => id)).toEqual(['broken'])
})

test('schema search reuses its index until a Domain render fingerprint changes', () => {
  const cache = new PaletteSearchIndexCache()
  const domains = [domain('alpha')]
  const firstBundle = { ir: null, renderFingerprint: 'sha-first' } as StudioSchemaBundle

  const first = cache.build(domains, [firstBundle])
  const unrelatedRender = cache.build(domains, [
    { ...firstBundle, extractedAt: 'later' } as StudioSchemaBundle,
  ])
  const changedSchema = cache.build(domains, [
    { ...firstBundle, renderFingerprint: 'sha-second' } as StudioSchemaBundle,
  ])

  expect(unrelatedRender).toBe(first)
  expect(changedSchema).not.toBe(first)
})
