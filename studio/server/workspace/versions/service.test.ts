import { afterEach, expect, test } from 'bun:test'

import { createVersions } from './service'
import {
  admittedBundle,
  answered,
  disposeProjects,
  fakeContext,
  indexStdout,
  project,
  publication,
  registryError,
  revision,
} from './test-fixtures'

afterEach(disposeProjects)

const ISSUES = 'issues.astrale.ai'
const LOCAL = revision('issues-local')
const SHELL_BUILT = revision('shell-built')

function setup() {
  const issues = project({
    id: 'issues',
    version: '0.8.8',
    environments:
      '{ development: { deployment: cloudflare() }, production: { deployment: cloudflare() } }',
  })
  const admin = project({ id: 'admin', version: '0.1.0-beta.63' })
  const unread = project({ id: 'unread' })
  const fake = fakeContext({
    domains: [issues, admin, unread],
    bundles: {
      issues: admittedBundle('issues', ISSUES, LOCAL),
      admin: admittedBundle('admin', 'admin.astrale.ai', revision('admin'), {
        issues: { origin: ISSUES, revision: LOCAL },
        shell: { origin: 'shell.astrale.ai', revision: SHELL_BUILT },
      }),
      unread: {
        ...admittedBundle('unread', 'unread.test', revision('x')),
        schemaMode: 'canonical-preview',
      },
    },
    cli: (args) => {
      if (args[2] === ISSUES) {
        return answered(
          indexStdout(ISSUES, [
            publication('0.9.1', revision('0.9.1')),
            publication('0.9.0', revision('0.9.0')),
            publication('0.8.9', revision('0.8.9')),
          ]),
        )
      }
      if (args[2] === 'admin.astrale.ai') return answered(indexStdout('admin.astrale.ai', []))
      return registryError(
        'REGISTRY_DOMAIN_NOT_FOUND',
        `No Domain ${args[2]} is readable by this caller.`,
      )
    },
  })
  return { issues, admin, unread, versions: createVersions(fake.context), recorded: fake.recorded }
}

test('local facts are read from disk alone', async () => {
  const { versions, recorded } = setup()
  const locals = await versions.locals()
  expect(
    locals.map((local) => [local.domainId, local.origin, local.declared, local.revision]),
  ).toEqual([
    ['issues', ISSUES, '0.8.8', LOCAL],
    ['admin', 'admin.astrale.ai', '0.1.0-beta.63', revision('admin')],
    ['unread', 'unread.test', '1.0.0', null],
  ])
  expect(locals[0]).toMatchObject({
    packageName: '@test/issues',
    git: null,
    environments: {
      declared: true,
      complete: true,
      environments: [
        {
          name: 'development',
          adapter: { module: '@astrale-os/adapter-cloudflare', export: 'cloudflare' },
        },
        {
          name: 'production',
          adapter: { module: '@astrale-os/adapter-cloudflare', export: 'cloudflare' },
        },
      ],
    },
  })
  expect(locals[1]?.environments).toEqual({ declared: false, environments: [], complete: true })
  expect(locals[1]?.dependencies.map((dependency) => dependency.alias)).toEqual(['issues', 'shell'])
  expect(locals[2]?.revisionError).toBe(
    "The Domain's installed SDK does not admit its current Schema.",
  )
  expect(recorded.cli).toEqual([])
})

test('a standing names the latest Publication and how the sources relate to it', async () => {
  const { versions, issues, admin, unread, recorded } = setup()
  expect(await versions.standing(issues)).toMatchObject({
    local: { domainId: 'issues', declared: '0.8.8' },
    index: { status: 'ok' },
    latest: { version: '0.9.1' },
    relation: { kind: 'behind', latest: '0.9.1' },
    carriedBy: [],
  })
  expect(await versions.standing(admin)).toMatchObject({
    relation: { kind: 'never-published', registered: true },
    carriedBy: [],
  })
  const standing = await versions.standing(unread)
  expect(standing).toMatchObject({
    index: { status: 'not-found' },
    relation: { kind: 'never-published', registered: false },
  })
  expect(standing.latest).toBeUndefined()
  expect(recorded.cli).toHaveLength(3)
})

test('each dependency names its built-against revision, its workspace copy and its carriers', async () => {
  const { versions, admin, unread } = setup()
  const dependencies = await versions.dependencies(admin)
  expect(dependencies).toMatchObject({
    domainId: 'admin',
    origin: 'admin.astrale.ai',
    revision: revision('admin'),
  })
  expect(dependencies.dependencies).toEqual([
    {
      alias: 'issues',
      origin: ISSUES,
      builtAgainst: LOCAL,
      local: { domainId: 'issues', revision: LOCAL, atBuiltAgainst: true },
      index: expect.objectContaining({ status: 'ok' }),
      carriedBy: [],
    },
    {
      alias: 'shell',
      origin: 'shell.astrale.ai',
      builtAgainst: SHELL_BUILT,
      local: null,
      index: expect.objectContaining({ status: 'not-found', code: 'REGISTRY_DOMAIN_NOT_FOUND' }),
      carriedBy: [],
    },
  ])
  expect(await versions.dependencies(unread)).toMatchObject({
    revision: null,
    dependencies: [],
    error: "The Domain's installed SDK does not admit its current Schema.",
  })
})
