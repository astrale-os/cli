import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EMBEDDED_ASSET_DIGEST } from '../../generated/embedded-assets'
import { embeddedFiles, materializeEmbeddedAssets } from '../embedded-assets'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('embedded standalone assets', () => {
  test('contains every asset family and materializes a cache safely under concurrency', async () => {
    expect(embeddedFiles('skills').some((file) => file.path.endsWith('/SKILL.md'))).toBe(true)
    expect(embeddedFiles('studio').some((file) => file.path === 'studio/index.html')).toBe(true)
    expect(embeddedFiles('viewer').some((file) => file.path === 'viewer/index.html')).toBe(true)

    const root = await mkdtemp(join(tmpdir(), 'astrale-embedded-assets-'))
    temporaryRoots.push(root)
    const [first, second] = await Promise.all([
      materializeEmbeddedAssets('studio', root),
      materializeEmbeddedAssets('studio', root),
    ])
    expect(second).toBe(first)
    expect(await readFile(join(first, '.complete'), 'utf8')).toBe(`${EMBEDDED_ASSET_DIGEST}\n`)
    expect(await readFile(join(first, 'index.html'), 'utf8')).toContain('<!doctype html>')
  })
})
