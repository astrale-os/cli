import type { DomainSummary, StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { paletteBundleQuery, paletteLoadState } from './command-palette'

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
