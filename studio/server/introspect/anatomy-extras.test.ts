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

test('does not treat a removed view registry as Schema authority', () => {
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

  expect(buildViews(root)).toEqual([])
})

test('joins canonical Bundle Views with defineFrontend route metadata', () => {
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
    `import { defineFrontend, vite } from '@astrale-os/sdk/application'
export const frontend = defineFrontend({
  schema,
  source: vite(),
  routes: { issue: '/ui/issues/:id' },
  entrypoint: 'issue',
})
`,
  )

  expect(findSchemaDefinition(root)).toMatchObject({ origin: 'current.example.dev' })
  expect(
    buildViews(root, 'schema', {
      issue: {
        name: 'issue',
        auth: 'optional',
        description: 'Inspect an issue.',
        target: {
          kind: 'definition',
          definitions: [
            { origin: 'issues.example.dev', kind: 'class', name: 'Issue' },
            { origin: 'accounts.example.dev', kind: 'class', name: 'Group' },
          ],
        },
      },
    }),
  ).toEqual([
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

test('discovers Vite frontend default routes from canonical View names', () => {
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
    `const source = vite()
export const frontend = defineFrontend({
  schema,
  source,
  entrypoint: 'summary',
})
`,
  )

  expect(
    buildViews(root, 'schema', {
      summary: {
        name: 'summary',
        auth: 'required',
        target: { kind: 'domain' },
      },
    }),
  ).toEqual([
    {
      slug: 'summary',
      kind: 'spa',
      auth: 'required',
      mount: '/summary',
      url: undefined,
      file: 'views/summary/index.ts',
    },
  ])
})

test('canonical Bundle views reject static schema and route-only identities', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-canonical-view-authority-'))
  roots.push(root)
  mkdirSync(join(root, 'schema'), { recursive: true })
  writeFileSync(
    join(root, 'schema', 'index.ts'),
    `export const schema = defineSchema('static.invalid', {
  views: {
    account: view({ target: WrongTarget, auth: 'public', description: 'Static guess.' }),
    sourceOnly: view({ target: WrongTarget, auth: 'public', description: 'Static guess.' }),
    invented: view({ target: 'domain', auth: 'public' }),
  },
})`,
  )
  writeFileSync(
    join(root, 'application.ts'),
    `export const frontend = defineFrontend({
  schema,
  source: external('https://shell.example.dev'),
  routes: {
    account: '/account',
    routeOnly: '/route-only',
  },
})`,
  )

  expect(
    buildViews(root, 'schema', {
      account: {
        name: 'account',
        auth: 'required',
        description: 'Admitted account view.',
        target: {
          kind: 'definition',
          definitions: [{ origin: 'accounts.example.dev', kind: 'class', name: 'Account' }],
        },
      },
      sourceOnly: {
        name: 'sourceOnly',
        auth: 'optional',
        description: 'Admitted source-only view.',
        target: { kind: 'domain' },
      },
    }),
  ).toEqual([
    {
      slug: 'account',
      kind: 'spa',
      auth: 'required',
      description: 'Admitted account view.',
      viewFor: 'Account',
      url: 'https://shell.example.dev/account',
      file: 'application.ts',
    },
    {
      slug: 'sourceOnly',
      kind: 'spa',
      auth: 'optional',
      description: 'Admitted source-only view.',
      url: 'https://shell.example.dev/source-only',
      file: 'application.ts',
    },
  ])
  expect(buildViews(root, 'schema', {})).toEqual([])
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
