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
  writeFileSync(join(owner, 'application.ts'), 'export default {}\n')
  writeFileSync(join(owner, 'schema/index.ts'), 'export const schema = {}\n')
  return root
}

describe('SDK V1 project discovery', () => {
  test('discovers conventional root Application and Schema entries', () => {
    const root = fixture()
    expect(isDomainDir(root)).toBe(true)
    expect(basename(resolveApplicationEntry(root)!)).toBe('application.ts')
    expect(basename(resolveSchemaEntry(root, resolveApplicationEntry(root)!)!)).toBe('index.ts')
    const handle = registerDomain(root)!
    domainIds.push(handle.id)
    expect(basename(handle.applicationFile)).toBe('application.ts')
    expect(handle.schemaDirName).toBe('schema')
  })

  test('follows a config-imported nested Application and adjacent Schema', () => {
    const root = fixture(true)
    const application = resolveApplicationEntry(root)!
    expect(application).toBe(join(root, 'domain/application.ts'))
    expect(resolveSchemaEntry(root, application)).toBe(join(root, 'domain/schema/index.ts'))
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
