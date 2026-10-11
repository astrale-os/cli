import { afterEach, expect, test } from 'bun:test'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { scanWorkspace } from '../workspace/scan'
import {
  analyzeProjectConfig,
  depsInstalled,
  getDomain,
  isDomainDir,
  registerDomain,
  resolveDomainEntry,
  resolveSchemaEntry,
  unregisterDomain,
} from './registry'

const roots: string[] = []
const domainIds: string[] = []

afterEach(() => {
  while (domainIds.length) unregisterDomain(domainIds.pop()!)
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

const PROJECT = `import { defineProject } from '@astrale-os/sdk/project'
import domain from './domain.js'
export default defineProject({ domain })
`
const DOMAIN = `import { defineDomain } from '@astrale-os/sdk/domain'
import { schema } from './schema/index.js'
export default defineDomain({ schema, runtime: {} as never })
`

/** A Domain folder: the conventional project, with any file replaced or added. */
function domainDir(files: Record<string, string> = {}, parent?: string): string {
  const root = parent ?? mkdtempSync(join(tmpdir(), 'studio-registry-'))
  if (!parent) roots.push(root)
  const all = {
    'astrale.config.ts': PROJECT,
    'domain.ts': DOMAIN,
    'schema/index.ts': 'export const schema = {}\n',
    ...files,
  }
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

function register(root: string) {
  const handle = registerDomain(root)
  if (handle) domainIds.push(handle.id)
  return handle
}

test('same-named projects keep separate, stable handles across rescans', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'studio-duplicate-domains-'))
  roots.push(workspace)
  const source = domainDir()
  const paths = [join(workspace, 'admin/domain'), join(workspace, 'ui/domain')]
  for (const path of paths) cpSync(source, path, { recursive: true })

  const initial = scanWorkspace(workspace)
  domainIds.push(...initial.map((handle) => handle.id))
  expect(new Set(initial.map((handle) => handle.id)).size).toBe(2)
  for (const handle of scanWorkspace(workspace)) {
    expect(handle).toBe(initial.find((entry) => entry.root === handle.root)!)
    expect(getDomain(handle.id)).toBe(handle)
  }
  // registration order does not decide identity
  for (const handle of initial) unregisterDomain(handle.id)
  for (const path of paths.toReversed())
    expect(registerDomain(path)?.id).toBe(initial.find((handle) => handle.root === path)?.id)
})

test('a handle is replaced when the Domain definition selects another Schema', () => {
  const root = domainDir()
  const first = register(root)!
  expect(registerDomain(root)).toBe(first)

  domainDir(
    {
      'model/replacement.ts': 'export const replacement = {}\n',
      'domain.ts': `import { defineDomain } from '@astrale-os/sdk/domain'
import { replacement } from './model/replacement.js'
export default defineDomain({ schema: replacement, runtime: {} as never })
`,
    },
    root,
  )
  expect(registerDomain(root)).toMatchObject({
    schemaIndex: join(root, 'model/replacement.ts'),
    schemaDirName: 'model',
  })
})

test('reads the Domain and Datasets of the default-exported Project only, through local bindings', () => {
  const root = domainDir({
    'domain.ts': 'export default {}\n',
    'domain/domain.ts': DOMAIN,
    'domain/schema/index.ts': 'export const schema = {}\n',
    'astrale.config.ts': `import { defineProject as project } from '@astrale-os/sdk/project'
import { dataset, tests } from '@astrale-os/sdk/testing'
import { domain as authored } from './domain/domain.js'
const unrelated = project({ tests: tests({ datasets: [dataset('./ignored.ts')] }) })
const selected = authored
export default project({
  domain: selected,
  // in order, once each; a reference computed at runtime is not a static one
  tests: tests({
    datasets: [
      dataset('./tests/demo.ts'),
      dataset(\`./tests/big.ts\`),
      dataset('./tests/demo.ts'),
      dataset(process.env.DYNAMIC ?? './tests/dynamic.ts'),
    ],
  }),
})
`,
  })
  expect(analyzeProjectConfig(root)).toEqual({
    domainFile: join(root, 'domain/domain.ts'),
    datasets: ['./tests/demo.ts', './tests/big.ts'],
  })
  expect(register(root)).toMatchObject({
    domainFile: join(root, 'domain/domain.ts'),
    schemaIndex: join(root, 'domain/schema/index.ts'),
  })
})

test.each([
  [
    'no Project',
    { 'astrale.config.ts': "import domain from './domain.js'\nexport default domain" },
  ],
  [
    'a Project without a Domain',
    {
      'astrale.config.ts':
        "import { defineProject } from '@astrale-os/sdk/project'\nexport default defineProject({})",
    },
  ],
  [
    'a missing Domain module',
    { 'astrale.config.ts': PROJECT.replace('./domain.js', './missing.js') },
  ],
  [
    'a defineDomain the SDK does not export',
    { 'domain.ts': DOMAIN.replace('@astrale-os/sdk/domain', './local-sdk.js') },
  ],
  ['a Domain that selects no Schema', { 'domain.ts': 'export default {}\n' }],
])('refuses %s, whatever conventional files exist', (_, files) => {
  const root = domainDir(files)
  expect(isDomainDir(root)).toBe(false)
  expect(registerDomain(root)).toBeNull()
})

test('follows the Schema binding through namespaces, folders and package aliases', () => {
  const schemaOf = (files: Record<string, string>) => {
    const root = domainDir(files)
    return resolveSchemaEntry(root, join(root, 'domain.ts'))?.slice(root.length + 1)
  }
  expect(
    schemaOf({
      'model/definition.ts': 'export const selected = {}\n',
      'domain.ts': `import { defineDomain as compose } from '@astrale-os/sdk'
import * as definitions from './model/definition.js'
export default compose({ schema: definitions.selected, runtime: {} as never })
`,
    }),
  ).toBe('model/definition.ts')
  expect(schemaOf({ 'domain.ts': DOMAIN.replace('./schema/index.js', './schema') })).toBe(
    'schema/index.ts',
  )
  // a standalone executable cannot ask its own resolver for a Domain's `imports`
  for (const target of ['./schema/index.ts', './schema/index.js'])
    expect(
      schemaOf({
        'package.json': JSON.stringify({ imports: { '#schema': target } }),
        'domain.ts': DOMAIN.replace('./schema/index.js', '#schema'),
      }),
    ).toBe('schema/index.ts')

  // …but never to a module outside the Domain root
  const outside = domainDir({ 'schema.ts': 'export const schema = {}\n' })
  const nested = domainDir(
    {
      'domain/package.json': JSON.stringify({ imports: { '#schema': '../schema.ts' } }),
      'domain/astrale.config.ts': PROJECT,
      'domain/domain.ts': DOMAIN.replace('./schema/index.js', '#schema'),
    },
    outside,
  )
  expect(isDomainDir(join(nested, 'domain'))).toBe(false)
})

test('an edit is seen on the very next analysis, even at the same size and mtime', () => {
  const root = domainDir({ 'schemb/index.ts': 'export const schema = {}\n' })
  const domainFile = join(root, 'domain.ts')
  expect(resolveSchemaEntry(root, domainFile)).toBe(join(root, 'schema/index.ts'))

  const stamp = statSync(domainFile)
  writeFileSync(domainFile, DOMAIN.replace('./schema/', './schemb/'))
  utimesSync(domainFile, stamp.atime, stamp.mtime)
  expect(resolveSchemaEntry(root, domainFile)).toBe(join(root, 'schemb/index.ts'))

  // module resolution stays live while the parsed sources are reused
  rmSync(join(root, 'schemb/index.ts'))
  expect(isDomainDir(root)).toBe(false)
  rmSync(join(root, 'astrale.config.ts'))
  expect(resolveDomainEntry(root)).toBeNull()
})

test('dependencies count as installed only with the semantic SDK', () => {
  const root = domainDir()
  mkdirSync(join(root, 'node_modules/@astrale-os/kernel-core'), { recursive: true })
  expect(depsInstalled(root)).toBe(false)
  mkdirSync(join(root, 'node_modules/@astrale-os/sdk'), { recursive: true })
  expect(depsInstalled(root)).toBe(true)
})
