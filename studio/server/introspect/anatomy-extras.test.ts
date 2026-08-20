import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildClientTree, buildViews, findSchemaDefinition } from './anatomy-extras'

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

test('reads the discovered client directory', () => {
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

test('joins current schema Views through a barrel with reactFrontend routes', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-current-react-view-'))
  roots.push(root)
  mkdirSync(join(root, 'schema', 'application'), { recursive: true })
  mkdirSync(join(root, 'views'), { recursive: true })
  writeFileSync(
    join(root, 'schema', 'index.ts'),
    `export { schema } from './application/index.js'\n`,
  )
  writeFileSync(
    join(root, 'schema', 'application', 'index.ts'),
    `import { defineSchema, view } from '@astrale-os/sdk/schema'
export const ORIGIN = 'current.example.dev' as const
const schemaInput = {
  classes: {},
  views: {
    issue: view({
      target: [Issue, Group],
      auth: 'optional',
      description: 'Inspect an issue.',
    }),
  },
} as const
export const schema = defineSchema(ORIGIN, schemaInput)
`,
  )
  writeFileSync(
    join(root, 'views', 'routes.ts'),
    `import { reactFrontend, reactRoute } from '@astrale-os/sdk/react'
const routes = {
  issue: reactRoute({ path: '/ui/issues/:id', component: { module: './views/issue.tsx' } }),
}
export const frontend = reactFrontend({ schema, routes, entrypoint: 'issue' })
`,
  )

  expect(findSchemaDefinition(root)).toMatchObject({ origin: 'current.example.dev' })
  expect(buildViews(root)).toEqual([
    {
      slug: 'issue',
      kind: 'spa',
      auth: 'optional',
      mount: '/ui/issues/:id',
      url: undefined,
      viewFor: ['Issue', 'Group'],
      file: 'views/routes.ts',
      description: 'Inspect an issue.',
    },
  ])
})

test('discovers generated frontend routes and applies current View defaults', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-current-generated-view-'))
  roots.push(root)
  mkdirSync(join(root, 'schema'), { recursive: true })
  mkdirSync(join(root, 'views', 'summary'), { recursive: true })
  writeFileSync(
    join(root, 'schema', 'index.ts'),
    `export const schema = defineSchema('generated.example.dev', {
  views: { summary: view({ target: 'domain' }) },
})
`,
  )
  writeFileSync(
    join(root, 'views', 'summary', 'index.ts'),
    `const source = generatedFrontend({ files: [{ path: 'index.html', content: '<h1>Hi</h1>' }] })
export const frontend = frontendArtifact({
  schema,
  source,
  routes: { summary: frontendRoute({}) },
  entrypoint: 'summary',
})
`,
  )

  expect(buildViews(root)).toEqual([
    {
      slug: 'summary',
      kind: 'inline-html',
      auth: 'required',
      mount: '/ui/summary',
      url: undefined,
      file: 'views/summary/index.ts',
    },
  ])
})

test('uses current ui modules as the client anatomy when no legacy client package is selected', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-current-ui-tree-'))
  roots.push(root)
  mkdirSync(join(root, 'ui', 'application'), { recursive: true })
  writeFileSync(
    join(root, 'ui', 'application', 'index.ts'),
    `export { Screen } from './screen.js'\n`,
  )
  writeFileSync(join(root, 'ui', 'application', 'screen.tsx'), `export const Screen = () => null\n`)

  expect(buildClientTree(root, null)).toMatchObject({
    present: true,
    features: [{ name: 'application', files: ['index.ts', 'screen.tsx'] }],
  })
})
