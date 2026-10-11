import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { invalidateClientPackage, resolveClientPackage } from './client-package'

const roots: string[] = []

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

describe('client package discovery', () => {
  test('discovers the sole workspace preview package without executing domain config', async () => {
    const root = fixture({ workspaces: ['frontend', 'schema'] })
    const frontend = join(root, 'frontend')
    writePackage(frontend, { scripts: { 'dev:hmr': 'vite' } })
    writePackage(join(root, 'schema'), {})
    writeFileSync(join(root, 'astrale.config.ts'), 'throw new Error("must not execute")\n')

    const first = await resolveClientPackage(root)
    const second = await resolveClientPackage(root)

    expect(first).toEqual({
      status: 'available',
      packageDir: frontend,
      sourceDir: frontend,
      packageFile: join(frontend, 'package.json'),
      devScript: 'vite',
      source: 'workspace',
    })
    expect(second).toEqual(first)
  })

  test('discovers a conventional direct child without workspace metadata', async () => {
    const root = fixture()
    const client = join(root, 'client')
    writePackage(client, { scripts: { 'dev:hmr': 'vite' } })

    expect(await resolveClientPackage(root)).toMatchObject({
      status: 'available',
      packageDir: client,
      sourceDir: client,
      source: 'workspace',
    })
  })

  test('discovers nested packages from pnpm-workspace.yaml', async () => {
    const root = fixture()
    const web = join(root, 'apps', 'web')
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
    writePackage(web, { scripts: { 'dev:hmr': 'vite' } })

    expect(await resolveClientPackage(root)).toMatchObject({
      status: 'available',
      packageDir: web,
      sourceDir: web,
      source: 'workspace',
    })
  })

  test('uses an explicit root script to disambiguate multiple preview packages', async () => {
    const root = fixture({
      workspaces: ['apps/*'],
      scripts: { 'dev:hmr': 'pnpm --dir apps/web dev:hmr' },
    })
    writePackage(join(root, 'apps', 'admin'), { scripts: { 'dev:hmr': 'vite' } })
    writePackage(join(root, 'apps', 'web'), { scripts: { 'dev:hmr': 'vite' } })

    expect(await resolveClientPackage(root)).toEqual({
      status: 'available',
      packageDir: root,
      sourceDir: root,
      packageFile: join(root, 'package.json'),
      devScript: 'pnpm --dir apps/web dev:hmr',
      source: 'root',
    })
  })

  test('rejects ambiguous preview packages without guessing', async () => {
    const root = fixture({ workspaces: ['apps/*'] })
    writePackage(join(root, 'apps', 'admin'), { scripts: { 'dev:hmr': 'vite' } })
    writePackage(join(root, 'apps', 'web'), { scripts: { 'dev:hmr': 'vite' } })

    expect(await resolveClientPackage(root)).toEqual({
      status: 'unavailable',
      reason:
        'Multiple packages define dev:hmr (apps/admin, apps/web). Add a dev:hmr script to the domain root to choose one.',
    })
  })

  test('reports a domain with no preview package', async () => {
    const root = fixture({ workspaces: ['frontend', 'schema'] })
    writePackage(join(root, 'frontend'), {})
    writePackage(join(root, 'schema'), {})

    expect(await resolveClientPackage(root)).toEqual({
      status: 'unavailable',
      reason: 'This domain has no package that defines a dev:hmr script.',
    })
  })

  test('invalidates cached discovery when an inspected package changes', async () => {
    const root = fixture({ workspaces: ['frontend'] })
    const frontend = join(root, 'frontend')
    writePackage(frontend, {})
    expect((await resolveClientPackage(root)).status).toBe('unavailable')

    writePackage(frontend, { scripts: { 'dev:hmr': 'vite' } })

    expect(await resolveClientPackage(root)).toMatchObject({
      status: 'available',
      packageDir: frontend,
    })
  })

  test('invalidates cached discovery when a nested workspace package is added', async () => {
    const root = fixture({ workspaces: ['apps/*'] })
    const apps = join(root, 'apps')
    mkdirSync(apps)
    expect((await resolveClientPackage(root)).status).toBe('unavailable')

    const web = join(apps, 'web')
    writePackage(web, { scripts: { 'dev:hmr': 'vite' } })

    expect(await resolveClientPackage(root)).toMatchObject({
      status: 'available',
      packageDir: web,
    })
  })
})
