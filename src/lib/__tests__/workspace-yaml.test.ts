import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { findAllWorkspaceRoots, registerWorkspaceMember } from '../workspace-yaml'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'astrale-ws-yaml-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function seedTarget(rel: string): Promise<string> {
  const target = join(root, rel)
  await mkdir(join(target, 'test'), { recursive: true })
  await mkdir(join(target, 'worker', 'client'), { recursive: true })
  return target
}

async function writeYaml(path: string, body: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, body)
}

describe('findAllWorkspaceRoots', () => {
  test('returns ancestors containing pnpm-workspace.yaml, closest first', async () => {
    const outer = join(root, 'mono')
    const inner = join(outer, 'domains')
    await writeYaml(join(outer, 'pnpm-workspace.yaml'), 'packages:\n  - "pkg-a"\n')
    await writeYaml(join(inner, 'pnpm-workspace.yaml'), 'packages:\n  - "x"\n')
    const deep = join(inner, 'a', 'b', 'c')
    await mkdir(deep, { recursive: true })
    expect(findAllWorkspaceRoots(deep)).toEqual([inner, outer])
  })

  test('returns an empty list when no ancestor has the yaml', async () => {
    const lone = join(root, 'lone')
    await mkdir(lone, { recursive: true })
    expect(findAllWorkspaceRoots(lone)).toEqual([])
  })
})

describe('registerWorkspaceMember', () => {
  test('appends the four sub-paths to the host yaml, idempotently', async () => {
    const yamlPath = join(root, 'pnpm-workspace.yaml')
    await writeYaml(yamlPath, "# pinned\npackages:\n  - 'kernel'\n")

    const target = await seedTarget('domains/bookshelf')

    const r1 = await registerWorkspaceMember(target)
    expect(r1.updated).toHaveLength(1)
    expect(r1.updated[0]?.added).toEqual([
      'domains/bookshelf',
      'domains/bookshelf/test',
      'domains/bookshelf/worker',
      'domains/bookshelf/worker/client',
    ])

    const after = await readFile(yamlPath, 'utf-8')
    expect(after).toContain("- 'kernel'")
    expect(after).toContain('# pinned')
    expect(after).toContain("- 'domains/bookshelf'")
    expect(after).toContain("- 'domains/bookshelf/worker/client'")

    // Idempotent.
    const r2 = await registerWorkspaceMember(target)
    expect(r2.updated).toHaveLength(0)
    expect(r2.alreadyPresent).toEqual([yamlPath])
    expect(await readFile(yamlPath, 'utf-8')).toBe(after)
  })

  test('updates both the root yaml and the inner domains/ yaml when both exist', async () => {
    const rootYaml = join(root, 'pnpm-workspace.yaml')
    await writeYaml(rootYaml, "packages:\n  - 'kernel'\n")
    const innerYaml = join(root, 'domains', 'pnpm-workspace.yaml')
    await writeYaml(innerYaml, "packages:\n  - 'distribution'\n")

    const target = await seedTarget('domains/bookshelf')

    const r = await registerWorkspaceMember(target)
    expect(r.updated.map((u) => u.path).sort()).toEqual([rootYaml, innerYaml].sort())

    const rootAfter = await readFile(rootYaml, 'utf-8')
    const innerAfter = await readFile(innerYaml, 'utf-8')

    expect(rootAfter).toContain("- 'domains/bookshelf'")
    expect(rootAfter).toContain("- 'domains/bookshelf/worker/client'")
    expect(innerAfter).toContain("- 'bookshelf'")
    expect(innerAfter).toContain("- 'bookshelf/worker/client'")
    expect(innerAfter).not.toContain("- 'domains/bookshelf'")
  })

  test('warns and skips when the host yaml has no `packages` sequence', async () => {
    const yamlPath = join(root, 'pnpm-workspace.yaml')
    await writeYaml(yamlPath, '# top-level packages key absent\nname: weird\n')
    const target = await seedTarget('domains/bookshelf')

    const r = await registerWorkspaceMember(target)
    expect(r.updated).toHaveLength(0)
    expect(r.alreadyPresent).toHaveLength(0)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain(yamlPath)
  })

  test('returns an empty result when no ancestor yaml exists', async () => {
    const target = await seedTarget('lone')
    const r = await registerWorkspaceMember(target)
    expect(r).toEqual({ updated: [], alreadyPresent: [], warnings: [] })
  })

  test('preserves existing entries and final newline', async () => {
    const yamlPath = join(root, 'pnpm-workspace.yaml')
    const original = "packages:\n  - 'kernel'\n  - 'sdk'\n# trailing comment\n"
    await writeYaml(yamlPath, original)
    const target = await seedTarget('domains/foo')

    await registerWorkspaceMember(target)
    const after = await readFile(yamlPath, 'utf-8')
    expect(after).toContain("- 'kernel'")
    expect(after).toContain("- 'sdk'")
    expect(after).toContain('# trailing comment')
    expect(after.endsWith('\n')).toBe(true)
  })
})
