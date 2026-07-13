import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildClientTree, buildViews } from './anatomy-extras'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('discovers view mounts from any top-level client route registry', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-client-tree-'))
  roots.push(root)
  const src = join(root, 'client', 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(
    join(src, 'views.tsx'),
    `const VIEW_REGISTRY = {
      '/ui/issues': IssuesView,
      '/ui/issue': TargetIssueView,
    }`,
  )
  writeFileSync(join(src, 'app.tsx'), `const ROUTES = { '/ui/settings': SettingsView }`)

  expect(buildClientTree(root).routes).toEqual({
    '/ui/issue': 'TargetIssueView',
    '/ui/issues': 'IssuesView',
    '/ui/settings': 'SettingsView',
  })
})

test('reads the adapter-selected client directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-client-tree-configured-'))
  roots.push(root)
  const clientDir = join(root, 'frontend')
  const src = join(clientDir, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'views.tsx'), `const VIEWS = { '/ui/models': ModelsView }`)

  expect(buildClientTree(root, clientDir)).toMatchObject({
    present: true,
    routes: { '/ui/models': 'ModelsView' },
  })
})

test('resolves views declared in the registry file itself', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-inline-view-registry-'))
  roots.push(root)
  const viewsDir = join(root, 'views')
  mkdirSync(viewsDir, { recursive: true })
  writeFileSync(
    join(viewsDir, 'index.ts'),
    `import { defineView } from '@astrale-os/sdk'
const services = defineView({
  auth: 'required',
  mount: '/ui/services',
  description: 'Browse services.',
})
const service = defineView({
  auth: 'required',
  mount: '/ui/service',
  viewFor: [selfOf(CloudflareWorker)],
})
export const views = { services, service }
`,
  )

  expect(buildViews(root)).toEqual([
    {
      slug: 'services',
      kind: 'spa',
      url: undefined,
      file: 'views/index.ts',
      auth: 'required',
      mount: '/ui/services',
      description: 'Browse services.',
    },
    {
      slug: 'service',
      kind: 'spa',
      url: undefined,
      file: 'views/index.ts',
      auth: 'required',
      mount: '/ui/service',
      viewFor: 'CloudflareWorker',
    },
  ])
})
