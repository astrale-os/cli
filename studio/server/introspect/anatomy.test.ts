import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildAnatomy } from './anatomy'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function project(nested: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'studio-anatomy-application-'))
  roots.push(root)
  const owner = nested ? join(root, 'domain') : root
  mkdirSync(join(owner, 'schema'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{}\n')
  writeFileSync(
    join(root, 'astrale.config.ts'),
    nested
      ? "import application from './domain/application.js'\nexport default { application }\n"
      : 'export default {}\n',
  )
  writeFileSync(join(owner, 'application.ts'), 'export const application = {}\n')
  writeFileSync(
    join(owner, 'schema/index.ts'),
    "defineSchema('example.astrale.ai', { classes: {} })\n",
  )
  return { root, schemaDirName: nested ? 'domain/schema' : 'schema' }
}

test('overview anchors a root Application', () => {
  const input = project(false)
  expect(buildAnatomy(input).overview.applicationFile).toBe('application.ts')
})

test('overview preserves the config-imported nested Application path', () => {
  const input = project(true)
  expect(buildAnatomy(input).overview.applicationFile).toBe('domain/application.ts')
})
