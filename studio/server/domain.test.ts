import { afterEach, describe, expect, test } from 'bun:test'
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
import { basename, join } from 'node:path'

import { scanWorkspace } from './detect'
import {
  analyzeProjectConfig,
  depsInstalled,
  isDomainDir,
  registerDomain,
  resolveDomainEntry,
  resolveSchemaEntry,
  unregisterDomain,
} from './domain'
import { getDomain } from './domain'

const roots: string[] = []
const domainIds: string[] = []

afterEach(() => {
  while (domainIds.length) unregisterDomain(domainIds.pop()!)
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function projectConfig(domain = './domain.js'): string {
  return `import { defineProject } from '@astrale-os/sdk/project'
import { cloudflare } from '@astrale-os/adapter-cloudflare'
import domain from '${domain}'
export default defineProject({ domain, environments: { development: { deployment: cloudflare({}) } } })
`
}

function fixture(nested = false): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-domain-layout-'))
  roots.push(root)
  const owner = nested ? join(root, 'domain') : root
  mkdirSync(join(owner, 'schema'), { recursive: true })
  writeFileSync(
    join(root, 'astrale.config.ts'),
    projectConfig(nested ? './domain/domain.js' : './domain.js'),
  )
  writeFileSync(join(owner, 'schema/index.ts'), 'export const schema = {}\n')
  writeFileSync(
    join(owner, 'domain.ts'),
    `import { defineDomain } from '@astrale-os/sdk/domain'
import { schema } from './schema/index.js'
export default defineDomain({ schema, runtime: {} as never })
`,
  )
  return root
}

describe('SDK V1 project discovery', () => {
  test('same-named projects keep separate identities and handles across rescans and registration order', () => {
    const source = fixture()
    const workspace = mkdtempSync(join(tmpdir(), 'studio-duplicate-domains-'))
    roots.push(workspace)
    const paths = [join(workspace, 'admin/domain'), join(workspace, 'ui/domain')]
    for (const path of paths) cpSync(source, path, { recursive: true })
    const initial = scanWorkspace(workspace)
    domainIds.push(...initial.map((handle) => handle.id))
    expect(initial).toHaveLength(2)
    expect(new Set(initial.map((handle) => handle.id)).size).toBe(2)
    for (let scan = 0; scan < 3; scan += 1) {
      for (const handle of scanWorkspace(workspace)) {
        expect(handle).toBe(initial.find((entry) => entry.root === handle.root)!)
        expect(getDomain(handle.id)!).toBe(handle)
      }
    }
    for (const handle of initial) unregisterDomain(handle.id)
    for (const path of paths.toReversed()) {
      expect(registerDomain(path)?.id).toBe(initial.find((handle) => handle.root === path)?.id)
    }
  })
  test('uses only the default-exported Project for the Domain definition and datasets', () => {
    const root = fixture(true)
    writeFileSync(
      join(root, 'astrale.config.ts'),
      `import { defineProject as project } from '@astrale-os/sdk/project'
import { cloudflare } from '@astrale-os/adapter-cloudflare'
import { tests, dataset } from '@astrale-os/sdk/testing'
import domain from './domain/domain.js'
const unrelated = project({ tests: tests({ datasets: [dataset('./ignored.ts')] }) })
const selected = project({
  domain, environments: { development: { deployment: cloudflare({}) } },
  tests: tests({ datasets: [dataset('./selected.ts')] }),
})
export default selected
`,
    )
    expect(analyzeProjectConfig(root)).toEqual({
      domainFile: join(root, 'domain/domain.ts'),
      datasets: ['./selected.ts'],
    })
  })

  test.each([
    '',
    "import domain from './domain.js'\nexport default { domain }",
    "import domain from './domain.js'\nexport default domain",
    "import { defineProject } from '@astrale-os/sdk/project'\ndefineProject({})\nexport default {}",
    "import { defineProject } from '@astrale-os/sdk/project'\nexport default defineProject({})",
  ])('rejects missing Project authority without falling back: %s', (config) => {
    const root = fixture()
    writeFileSync(join(root, 'astrale.config.ts'), config)
    expect(resolveDomainEntry(root)).toBeNull()
    expect(isDomainDir(root)).toBe(false)
    expect(registerDomain(root)).toBeNull()
  })

  test('rejects a missing declared Domain definition even when a conventional file exists', () => {
    const root = fixture()
    writeFileSync(join(root, 'astrale.config.ts'), projectConfig('./missing.ts'))
    expect(isDomainDir(root)).toBe(false)
    expect(registerDomain(root)).toBeNull()
  })

  test('does not recover the Domain definition from the legacy deployment aggregate', () => {
    const root = fixture()
    writeFileSync(
      join(root, 'astrale.config.ts'),
      `import { defineProject } from '@astrale-os/sdk/project'
import { deploy } from '@astrale-os/sdk/deployment'
import application from './domain.js'
export default defineProject({ deployment: deploy({ application }) })
`,
    )
    expect(resolveDomainEntry(root)).toBeNull()
    expect(isDomainDir(root)).toBe(false)
  })

  test('follows defineDomain imported from the root SDK facade', () => {
    const root = fixture()
    writeFileSync(
      join(root, 'domain.ts'),
      `import { defineDomain } from '@astrale-os/sdk'
import { schema } from './schema/index.js'
export default defineDomain({ schema, runtime: {} as never })
`,
    )
    expect(resolveSchemaEntry(root, join(root, 'domain.ts'))).toBe(join(root, 'schema/index.ts'))
    expect(isDomainDir(root)).toBe(true)
  })

  test('rejects a defineDomain that the SDK does not export', () => {
    const root = fixture()
    writeFileSync(
      join(root, 'domain.ts'),
      `import { defineDomain } from './local-sdk.js'
import { schema } from './schema/index.js'
export default defineDomain({ schema, runtime: {} as never })
`,
    )
    expect(isDomainDir(root)).toBe(false)
    expect(registerDomain(root)).toBeNull()
  })

  test('follows the Domain definition declared by defineProject before the conventional root file', () => {
    const root = fixture(true)
    // A stray root domain.ts must not shadow the Project's declared Domain definition.
    writeFileSync(join(root, 'domain.ts'), 'export default {}\n')
    writeFileSync(
      join(root, 'astrale.config.ts'),
      `import { cloudflare } from '@astrale-os/adapter-cloudflare'
import { defineProject } from '@astrale-os/sdk/project'
import { dataset, tests } from '@astrale-os/sdk/testing'
import { domain as authored } from './domain/domain.js'
const selectedDomain = authored
export default defineProject({
  domain: selectedDomain,
  environments: { development: { deployment: cloudflare({}) } },
  tests: tests({ datasets: [dataset('./tests/datasets/demo.ts'), dataset(\`./tests/datasets/big.ts\`)] }),
})
`,
    )
    expect(analyzeProjectConfig(root)).toEqual({
      domainFile: join(root, 'domain/domain.ts'),
      datasets: ['./tests/datasets/demo.ts', './tests/datasets/big.ts'],
    })
    expect(resolveDomainEntry(root)).toBe(join(root, 'domain/domain.ts'))
    expect(isDomainDir(root)).toBe(true)
    const handle = registerDomain(root)!
    domainIds.push(handle.id)
    expect(handle.domainFile).toBe(join(root, 'domain/domain.ts'))
  })

  test('rejects a conventional root Domain definition without defineProject', () => {
    const root = fixture()
    writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
    expect(analyzeProjectConfig(root)).toEqual({ domainFile: null, datasets: [] })
    expect(resolveDomainEntry(root)).toBeNull()
    expect(isDomainDir(root)).toBe(false)
    expect(registerDomain(root)).toBeNull()
  })

  test('discovers the Schema selected by the Project Domain definition', () => {
    const root = fixture()
    expect(isDomainDir(root)).toBe(true)
    expect(basename(resolveDomainEntry(root)!)).toBe('domain.ts')
    expect(basename(resolveSchemaEntry(root, resolveDomainEntry(root)!)!)).toBe('index.ts')
    const handle = registerDomain(root)!
    domainIds.push(handle.id)
    expect(basename(handle.domainFile)).toBe('domain.ts')
    expect(handle.schemaDirName).toBe('schema')
  })

  test('follows a config-imported nested Domain definition and its Schema binding', () => {
    const root = fixture(true)
    const domainFile = resolveDomainEntry(root)!
    expect(domainFile).toBe(join(root, 'domain/domain.ts'))
    expect(resolveSchemaEntry(root, domainFile)).toBe(join(root, 'domain/schema/index.ts'))
  })

  test('uses the Domain definition schema instead of guessing a conventional Schema path', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-domain-source-of-truth-'))
    roots.push(root)
    mkdirSync(join(root, 'model'), { recursive: true })
    mkdirSync(join(root, 'schema'), { recursive: true })
    writeFileSync(join(root, 'astrale.config.ts'), projectConfig())
    writeFileSync(join(root, 'schema/index.ts'), 'export const decoy = {}\n')
    writeFileSync(join(root, 'model/domain-definition.ts'), 'export const selected = {}\n')
    writeFileSync(
      join(root, 'domain.ts'),
      `import { defineDomain as compose } from '@astrale-os/sdk/domain'
import * as definitions from './model/domain-definition.js'
export default compose({ schema: definitions.selected, runtime: {} as never })
`,
    )

    const domainFile = resolveDomainEntry(root)!
    expect(resolveSchemaEntry(root, domainFile)).toBe(join(root, 'model/domain-definition.ts'))
    const handle = registerDomain(root)!
    domainIds.push(handle.id)
    expect(handle.schemaDirName).toBe('model')
  })

  test('resolves an extensionless Schema directory import to its authored index', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-extensionless-schema-'))
    roots.push(root)
    mkdirSync(join(root, 'definition'))
    writeFileSync(join(root, 'astrale.config.ts'), projectConfig())
    writeFileSync(join(root, 'definition/index.ts'), 'export default {}\n')
    writeFileSync(
      join(root, 'domain.ts'),
      `import { defineDomain } from '@astrale-os/sdk/domain'
import schema from './definition'
export default defineDomain({ schema, runtime: {} as never })
`,
    )

    expect(resolveSchemaEntry(root, join(root, 'domain.ts'))).toBe(
      join(root, 'definition/index.ts'),
    )
  })

  test('follows a package `imports` alias to the authored Schema', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-alias-schema-'))
    roots.push(root)
    mkdirSync(join(root, 'schema'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'grc', type: 'module', imports: { '#schema': './schema/index.ts' } }),
    )
    writeFileSync(join(root, 'astrale.config.ts'), projectConfig())
    writeFileSync(join(root, 'schema/index.ts'), 'export const schema = {}\n')
    writeFileSync(
      join(root, 'domain.ts'),
      `import { defineDomain } from '@astrale-os/sdk/domain'
import { schema } from '#schema'
export default defineDomain({ schema, runtime: {} as never })
`,
    )

    expect(isDomainDir(root)).toBe(true)
    const handle = registerDomain(root)!
    domainIds.push(handle.id)
    expect(handle.schemaIndex).toBe(join(root, 'schema/index.ts'))
    expect(handle.schemaDirName).toBe('schema')
  })

  test('resolves an alias whose manifest target is the emitted .js path', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-alias-emitted-'))
    roots.push(root)
    mkdirSync(join(root, 'schema'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'grc', type: 'module', imports: { '#schema': './schema/index.js' } }),
    )
    writeFileSync(join(root, 'astrale.config.ts'), projectConfig())
    writeFileSync(join(root, 'schema/index.ts'), 'export const schema = {}\n')
    writeFileSync(
      join(root, 'domain.ts'),
      `import { defineDomain } from '@astrale-os/sdk/domain'
import { schema } from '#schema'
export default defineDomain({ schema, runtime: {} as never })
`,
    )

    expect(resolveSchemaEntry(root, join(root, 'domain.ts'))).toBe(join(root, 'schema/index.ts'))
  })

  test('rejects an alias that escapes the Domain root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'studio-alias-outside-'))
    roots.push(outside)
    writeFileSync(join(outside, 'schema.ts'), 'export const schema = {}\n')
    const root = join(outside, 'domain')
    mkdirSync(root)
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'grc', type: 'module', imports: { '#schema': '../schema.ts' } }),
    )
    writeFileSync(join(root, 'astrale.config.ts'), projectConfig())
    writeFileSync(
      join(root, 'domain.ts'),
      `import { defineDomain } from '@astrale-os/sdk/domain'
import { schema } from '#schema'
export default defineDomain({ schema, runtime: {} as never })
`,
    )

    expect(isDomainDir(root)).toBe(false)
  })

  test('rejects a conventional Schema that is not selected by the Domain definition', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-unbound-schema-'))
    roots.push(root)
    mkdirSync(join(root, 'schema'))
    writeFileSync(join(root, 'astrale.config.ts'), projectConfig())
    writeFileSync(join(root, 'domain.ts'), 'export default {}\n')
    writeFileSync(join(root, 'schema/index.ts'), 'export const schema = {}\n')
    expect(isDomainDir(root)).toBe(false)
  })

  test('preserves a stable handle and replaces it when the Domain definition selects another Schema', () => {
    const root = fixture()
    const first = registerDomain(root)!
    domainIds.push(first.id)
    expect(registerDomain(root)).toBe(first)

    mkdirSync(join(root, 'model'))
    writeFileSync(join(root, 'model/replacement.ts'), 'export const replacement = {}\n')
    writeFileSync(
      join(root, 'domain.ts'),
      `import { defineDomain } from '@astrale-os/sdk/domain'
import { replacement } from './model/replacement.js'
export default defineDomain({ schema: replacement, runtime: {} as never })
`,
    )

    const moved = registerDomain(root)!
    expect(moved).not.toBe(first)
    expect(moved.schemaIndex).toBe(join(root, 'model/replacement.ts'))
    expect(moved.schemaDirName).toBe('model')
  })

  test('requires the semantic SDK dependency, not Kernel implementation packages', () => {
    const root = fixture()
    expect(depsInstalled(root)).toBe(false)
    mkdirSync(join(root, 'node_modules', '@astrale-os', 'kernel-core'), { recursive: true })
    expect(depsInstalled(root)).toBe(false)
    mkdirSync(join(root, 'node_modules', '@astrale-os', 'sdk'), { recursive: true })
    expect(depsInstalled(root)).toBe(true)
  })

  test('rejects implementation.ts and a domain.ts that composes nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-legacy-layout-'))
    roots.push(root)
    mkdirSync(join(root, 'schema'))
    writeFileSync(join(root, 'astrale.config.ts'), projectConfig())
    writeFileSync(join(root, 'implementation.ts'), 'export default {}\n')
    writeFileSync(join(root, 'domain.ts'), 'export default {}\n')
    writeFileSync(join(root, 'schema/index.ts'), 'export const schema = {}\n')
    expect(isDomainDir(root)).toBe(false)
  })

  test('sees a same-size, same-mtime config or Domain definition edit on the very next analysis', () => {
    const root = fixture()
    mkdirSync(join(root, 'schemb'))
    writeFileSync(join(root, 'schemb/index.ts'), 'export const schema = {}\n')
    const domainFile = join(root, 'domain.ts')
    expect(resolveSchemaEntry(root, domainFile)).toBe(join(root, 'schema/index.ts'))
    expect(isDomainDir(root)).toBe(true)

    // Same byte length and restored mtime: only the content differs.
    const stamp = statSync(domainFile)
    writeFileSync(
      domainFile,
      `import { defineDomain } from '@astrale-os/sdk/domain'
import { schema } from './schemb/index.js'
export default defineDomain({ schema, runtime: {} as never })
`,
    )
    utimesSync(domainFile, stamp.atime, stamp.mtime)
    expect(resolveSchemaEntry(root, domainFile)).toBe(join(root, 'schemb/index.ts'))

    const config = join(root, 'astrale.config.ts')
    writeFileSync(config, projectConfig('./domai2.js'))
    expect(resolveDomainEntry(root)).toBeNull()
    expect(isDomainDir(root)).toBe(false)
    writeFileSync(config, projectConfig())
    expect(resolveDomainEntry(root)).toBe(domainFile)
    rmSync(config)
    expect(isDomainDir(root)).toBe(false)
    expect(analyzeProjectConfig(root).domainFile).toBeNull()
  })

  test('module resolution stays live while the parsed config is reused', () => {
    const root = fixture()
    expect(isDomainDir(root)).toBe(true)
    rmSync(join(root, 'schema/index.ts'))
    expect(isDomainDir(root)).toBe(false)
    writeFileSync(join(root, 'schema/index.ts'), 'export const schema = {}\n')
    expect(isDomainDir(root)).toBe(true)
    rmSync(join(root, 'domain.ts'))
    expect(resolveDomainEntry(root)).toBeNull()
  })
})

describe('retired Project application composition', () => {
  test.each(['@astrale-os/sdk/application', '@astrale-os/sdk'])(
    'does not discover an application Project or constructor from %s',
    (module) => {
      const root = fixture()
      writeFileSync(
        join(root, 'astrale.config.ts'),
        `import { defineProject } from '@astrale-os/sdk/project'
import application from './application.js'
export default defineProject({ application })
`,
      )
      writeFileSync(
        join(root, 'application.ts'),
        `import { defineApplication } from '${module}'
import { schema } from './schema/index.js'
export default defineApplication({ schema, runtime: {} as never })
`,
      )
      expect(resolveDomainEntry(root)).toBeNull()
      expect(resolveSchemaEntry(root, join(root, 'application.ts'))).toBeNull()
      expect(isDomainDir(root)).toBe(false)
      expect(registerDomain(root)).toBeNull()
    },
  )
})
