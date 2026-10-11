import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { foreignPackageManager, inDomainProject, parseSdkOutdated } from '../sdk-deps'

describe('parseSdkOutdated', () => {
  test('keeps only deps with a strictly newer latest; uses wanted when current is absent', () => {
    const json = JSON.stringify({
      '@astrale-os/sdk': { current: '0.1.5', wanted: '0.1.5', latest: '0.1.9' }, // behind
      '@astrale-os/sdk/schema': { current: '0.1.2', wanted: '0.1.2', latest: '0.1.2' }, // current
      '@astrale-os/shell': { wanted: '0.1.0', latest: '0.1.1' }, // no `current` (not installed)
    })
    expect(parseSdkOutdated(json)).toEqual([
      { pkg: '@astrale-os/sdk', current: '0.1.5', latest: '0.1.9' },
      { pkg: '@astrale-os/shell', current: '0.1.0', latest: '0.1.1' },
    ])
  })

  test('empty / non-JSON / no-latest input yields no upgrades (never throws)', () => {
    expect(parseSdkOutdated('')).toEqual([])
    expect(parseSdkOutdated('{}')).toEqual([])
    expect(parseSdkOutdated('not json')).toEqual([])
    expect(parseSdkOutdated(JSON.stringify({ '@astrale-os/sdk': { current: '0.1.9' } }))).toEqual(
      [],
    )
  })
})

describe('project detection', () => {
  let tmp: string
  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  })

  test('a Domain project has astrale.config.ts; a foreign lockfile names its package manager', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'sdk-deps-'))
    expect(inDomainProject(tmp)).toBe(false)
    // A fresh project is pnpm's, ours.
    expect(foreignPackageManager(tmp)).toBeNull()
    await writeFile(join(tmp, 'astrale.config.ts'), 'export default {}\n')
    expect(inDomainProject(tmp)).toBe(true)
    await writeFile(join(tmp, 'yarn.lock'), '')
    expect(foreignPackageManager(tmp)).toBe('yarn')
    await rm(join(tmp, 'yarn.lock'))
    await writeFile(join(tmp, 'package-lock.json'), '{}')
    expect(foreignPackageManager(tmp)).toBe('npm')
    // pnpm-lock wins even alongside another lockfile.
    await writeFile(join(tmp, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    expect(foreignPackageManager(tmp)).toBeNull()
  })
})
