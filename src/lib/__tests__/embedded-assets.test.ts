import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EMBEDDED_ASSET_DIGEST, EMBEDDED_SKILLS } from '../../generated/embedded-assets'
import { embeddedFiles, materializeEmbeddedAssets } from '../embedded-assets'
import { computeSkillTreeHash } from '../skills/sync'

const temporaryRoots: string[] = []
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('embedded standalone assets', () => {
  test('binds every embedded skill to its current source tree', async () => {
    const sourceSkillNames: string[] = []
    for (const entry of await readdir(join(repositoryRoot, 'skills'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (existsSync(join(repositoryRoot, 'skills', entry.name, 'SKILL.md'))) {
        sourceSkillNames.push(entry.name)
      }
    }
    expect(EMBEDDED_SKILLS.map(({ name }) => String(name)).sort()).toEqual(sourceSkillNames.sort())
    for (const skill of EMBEDDED_SKILLS) {
      expect(await computeSkillTreeHash(join(repositoryRoot, 'skills', skill.name))).toBe(
        skill.tree,
      )
    }
  })

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
