import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { invalidateClientPackage, resolveClientPackage } from './client-package'

const roots: string[] = []
const PREVIEW = { scripts: { 'dev:hmr': 'vite' } }

function fixture(rootPackage: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-client-package-'))
  roots.push(root)
  writePackage(root, rootPackage)
  return root
}

function writePackage(dir: string, pkg: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, ...pkg }))
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    invalidateClientPackage(root)
    rmSync(root, { recursive: true, force: true })
  }
})

test('discovers the sole preview package without executing domain config', async () => {
  const root = fixture({ workspaces: ['frontend', 'schema'] })
  const frontend = join(root, 'frontend')
  writePackage(frontend, PREVIEW)
  writePackage(join(root, 'schema'), {})
  writeFileSync(join(root, 'astrale.config.ts'), 'throw new Error("must not execute")\n')
  expect(await resolveClientPackage(root)).toEqual({
    status: 'available',
    packageDir: frontend,
    sourceDir: frontend,
    packageFile: join(frontend, 'package.json'),
    devScript: 'vite',
    source: 'workspace',
  })

  // a conventional direct child, or a pnpm workspace, needs no `workspaces` field
  const child = fixture()
  writePackage(join(child, 'client'), PREVIEW)
  expect(await resolveClientPackage(child)).toMatchObject({ packageDir: join(child, 'client') })
  const pnpm = fixture()
  writeFileSync(join(pnpm, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
  writePackage(join(pnpm, 'apps/web'), PREVIEW)
  expect(await resolveClientPackage(pnpm)).toMatchObject({ packageDir: join(pnpm, 'apps/web') })
})

test('several preview packages need a root script to choose; it never guesses', async () => {
  const root = fixture({ workspaces: ['apps/*'] })
  writePackage(join(root, 'apps/admin'), PREVIEW)
  writePackage(join(root, 'apps/web'), PREVIEW)
  expect(await resolveClientPackage(root)).toEqual({
    status: 'unavailable',
    reason:
      'Multiple packages define dev:hmr (apps/admin, apps/web). Add a dev:hmr script to the domain root to choose one.',
  })

  const chosen = fixture({
    workspaces: ['apps/*'],
    scripts: { 'dev:hmr': 'pnpm --dir apps/web dev:hmr' },
  })
  writePackage(join(chosen, 'apps/admin'), PREVIEW)
  writePackage(join(chosen, 'apps/web'), PREVIEW)
  expect(await resolveClientPackage(chosen)).toMatchObject({
    packageDir: chosen,
    devScript: 'pnpm --dir apps/web dev:hmr',
    source: 'root',
  })
})

test('a cached answer follows an edited package and a newly added one', async () => {
  const root = fixture({ workspaces: ['frontend', 'apps/*'] })
  writePackage(join(root, 'frontend'), {})
  mkdirSync(join(root, 'apps'))
  expect(await resolveClientPackage(root)).toEqual({
    status: 'unavailable',
    reason: 'This domain has no package that defines a dev:hmr script.',
  })

  writePackage(join(root, 'apps/web'), PREVIEW)
  expect(await resolveClientPackage(root)).toMatchObject({ packageDir: join(root, 'apps/web') })
  writePackage(join(root, 'apps/web'), {})
  writePackage(join(root, 'frontend'), PREVIEW)
  expect(await resolveClientPackage(root)).toMatchObject({ packageDir: join(root, 'frontend') })
})
