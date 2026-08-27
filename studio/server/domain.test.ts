import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import {
  depsInstalled,
  isDomainDir,
  registerDomain,
  resolveApplicationEntry,
  resolveSchemaEntry,
  unregisterDomain,
} from './domain'

const roots: string[] = []
const domainIds: string[] = []

afterEach(() => {
  while (domainIds.length) unregisterDomain(domainIds.pop()!)
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fixture(nested = false): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-application-layout-'))
  roots.push(root)
  const owner = nested ? join(root, 'domain') : root
  mkdirSync(join(owner, 'schema'), { recursive: true })
  writeFileSync(
    join(root, 'astrale.config.ts'),
    nested
      ? "import application from './domain/application.js'\nexport default { application }\n"
      : 'export default {}\n',
  )
  writeFileSync(join(owner, 'schema/index.ts'), 'export const schema = {}\n')
  writeFileSync(
    join(owner, 'application.ts'),
    `import { defineApplication } from '@astrale-os/sdk/application'
import { schema } from './schema/index.js'
export default defineApplication({ schema, runtime: {} as never })
`,
  )
  return root
}

describe('SDK V1 project discovery', () => {
  test('discovers the Schema selected by the conventional root Application', () => {
    const root = fixture()
    expect(isDomainDir(root)).toBe(true)
    expect(basename(resolveApplicationEntry(root)!)).toBe('application.ts')
    expect(basename(resolveSchemaEntry(root, resolveApplicationEntry(root)!)!)).toBe('index.ts')
    const handle = registerDomain(root)!
    domainIds.push(handle.id)
    expect(basename(handle.applicationFile)).toBe('application.ts')
    expect(handle.schemaDirName).toBe('schema')
  })

  test('follows a config-imported nested Application and its Schema binding', () => {
    const root = fixture(true)
    const application = resolveApplicationEntry(root)!
    expect(application).toBe(join(root, 'domain/application.ts'))
    expect(resolveSchemaEntry(root, application)).toBe(join(root, 'domain/schema/index.ts'))
  })

  test('uses Application.schema instead of guessing a conventional Schema path', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-application-source-of-truth-'))
    roots.push(root)
    mkdirSync(join(root, 'model'), { recursive: true })
    mkdirSync(join(root, 'schema'), { recursive: true })
    writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
    writeFileSync(join(root, 'schema/index.ts'), 'export const decoy = {}\n')
    writeFileSync(join(root, 'model/domain-definition.ts'), 'export const selected = {}\n')
    writeFileSync(
      join(root, 'application.ts'),
      `import { defineApplication as compose } from '@astrale-os/sdk/application'
import * as definitions from './model/domain-definition.js'
export default compose({ schema: definitions.selected, runtime: {} as never })
`,
    )

    const application = resolveApplicationEntry(root)!
    expect(resolveSchemaEntry(root, application)).toBe(join(root, 'model/domain-definition.ts'))
    const handle = registerDomain(root)!
    domainIds.push(handle.id)
    expect(handle.schemaDirName).toBe('model')
  })

  test('resolves an extensionless Schema directory import to its authored index', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-extensionless-schema-'))
    roots.push(root)
    mkdirSync(join(root, 'definition'))
    writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
    writeFileSync(join(root, 'definition/index.ts'), 'export default {}\n')
    writeFileSync(
      join(root, 'application.ts'),
      `import { defineApplication } from '@astrale-os/sdk/application'
import schema from './definition'
export default defineApplication({ schema, runtime: {} as never })
`,
    )

    expect(resolveSchemaEntry(root, join(root, 'application.ts'))).toBe(
      join(root, 'definition/index.ts'),
    )
  })

  test('rejects a conventional Schema that is not selected by Application', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-unbound-schema-'))
    roots.push(root)
    mkdirSync(join(root, 'schema'))
    writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
    writeFileSync(join(root, 'application.ts'), 'export default {}\n')
    writeFileSync(join(root, 'schema/index.ts'), 'export const schema = {}\n')
    expect(isDomainDir(root)).toBe(false)
  })

  test('preserves a stable handle and replaces it when Application selects another Schema', () => {
    const root = fixture()
    const first = registerDomain(root)!
    domainIds.push(first.id)
    expect(registerDomain(root)).toBe(first)

    mkdirSync(join(root, 'model'))
    writeFileSync(join(root, 'model/replacement.ts'), 'export const replacement = {}\n')
    writeFileSync(
      join(root, 'application.ts'),
      `import { defineApplication } from '@astrale-os/sdk/application'
import { replacement } from './model/replacement.js'
export default defineApplication({ schema: replacement, runtime: {} as never })
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

  test('rejects implementation.ts and domain.ts compatibility layouts', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-legacy-layout-'))
    roots.push(root)
    mkdirSync(join(root, 'schema'))
    writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
    writeFileSync(join(root, 'implementation.ts'), 'export default {}\n')
    writeFileSync(join(root, 'domain.ts'), 'export default {}\n')
    writeFileSync(join(root, 'schema/index.ts'), 'export const schema = {}\n')
    expect(isDomainDir(root)).toBe(false)
  })
})
