import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { buildClientTree } from './anatomy/client-tree'
import { findSchemaDefinition } from './anatomy/schema-definition'
import { buildViews } from './anatomy/views'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-anatomy-'))
  roots.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

test('reads the client tree: route registries of a client package, or the ui modules', () => {
  const root = project({
    'frontend/src/views.tsx': `const VIEW_REGISTRY = { '/ui/issue': TargetIssueView }`,
    'frontend/src/app.tsx': `const ROUTES = { '/ui/settings': SettingsView }`,
    'ui/application/index.ts': 'export {}\n',
  })
  expect(buildClientTree(root, join(root, 'frontend')).routes).toEqual({
    '/ui/issue': 'TargetIssueView',
    '/ui/settings': 'SettingsView',
  })
  expect(buildClientTree(root, null)).toMatchObject({
    present: true,
    features: [{ name: 'application', files: ['index.ts'] }],
  })
})

test('joins canonical Bundle Views with defineFrontend routes, or their default mount', () => {
  const root = project({
    'schema/index.ts': `export { schema } from './application/index.js'\n`,
    'schema/application/index.ts': `import { defineSchema, view } from '@astrale-os/sdk/schema'
export const ORIGIN = 'current.example.dev' as const
const schemaInput = { name: 'Test Domain', entrypoint: 'issue', views: { issue: view({}) } } as const
export const schema = defineSchema(ORIGIN, schemaInput)
`,
    'views/routes.ts': `import { defineFrontend, vite } from '@astrale-os/sdk/domain'
export const frontend = defineFrontend({ schema, source: vite(), routes: { issue: '/ui/issues/:id' } })
`,
  })
  expect(findSchemaDefinition(root)).toMatchObject({ origin: 'current.example.dev' })
  expect(
    buildViews(root, 'schema', { issue: { name: 'issue', description: 'Inspect an issue.' } }),
  ).toEqual([
    {
      slug: 'issue',
      kind: 'spa',
      mount: '/ui/issues/:id',
      url: undefined,
      file: 'views/routes.ts',
      description: 'Inspect an issue.',
    },
  ])

  const generated = project({
    'schema/index.ts': `export const schema = defineSchema('generated.example.dev', { name: 'Test Domain', views: { summary: view({}) } })\n`,
    'views/summary/index.ts': `const source = vite()\nexport const frontend = defineFrontend({ schema, source })\n`,
  })
  expect(buildViews(generated, 'schema', { summary: { name: 'summary' } })).toEqual([
    {
      slug: 'summary',
      kind: 'spa',
      mount: '/summary',
      url: undefined,
      file: 'views/summary/index.ts',
    },
  ])
})

test('only admitted Views are listed: not static schema guesses, not route-only names', () => {
  const root = project({
    // the frontend is found through the Project's Domain module
    'astrale.config.ts': `import { defineProject } from '@astrale-os/sdk/project'
import { domain } from './domain.js'
export default defineProject({ domain })
`,
    'schema/index.ts': `export const schema = defineSchema('static.invalid', { name: 'Test Domain',
  views: { account: view({ description: 'Static guess.' }), sourceOnly: view({}), invented: view({}) },
})`,
    'domain.ts': `export const frontend = defineFrontend({
  schema,
  source: external('https://shell.example.dev'),
  routes: { account: '/account', routeOnly: '/route-only' },
})`,
  })
  expect(
    buildViews(root, 'schema', {
      account: { name: 'account', description: 'Admitted account view.' },
      sourceOnly: { name: 'sourceOnly' },
    }),
  ).toEqual([
    {
      slug: 'account',
      kind: 'spa',
      description: 'Admitted account view.',
      url: 'https://shell.example.dev/account',
      file: 'domain.ts',
    },
    {
      slug: 'sourceOnly',
      kind: 'spa',
      url: 'https://shell.example.dev/source-only',
      file: 'domain.ts',
    },
  ])
  expect(buildViews(root, 'schema', {})).toEqual([])
})
