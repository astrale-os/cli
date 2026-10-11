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
  const root = mkdtempSync(join(tmpdir(), 'studio-anatomy-domain-'))
  roots.push(root)
  const owner = nested ? join(root, 'domain') : root
  mkdirSync(join(owner, 'schema'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{}\n')
  writeFileSync(
    join(root, 'astrale.config.ts'),
    `import { defineProject } from '@astrale-os/sdk/project'
import { cloudflare } from '@astrale-os/adapter-cloudflare'
import { domain } from '${nested ? './domain/domain.js' : './domain.js'}'
export default defineProject({ domain, environments: { development: { deployment: cloudflare({}) } } })
`,
  )
  writeFileSync(join(owner, 'domain.ts'), 'export const domain = {}\n')
  writeFileSync(
    join(owner, 'schema/index.ts'),
    "defineSchema('example.astrale.ai', { name: 'Test Domain', classes: {} })\n",
  )
  return { root, schemaDirName: nested ? 'domain/schema' : 'schema' }
}

test('the overview names the Domain definition the configuration imports', () => {
  expect(buildAnatomy(project(false)).overview.domainFile).toBe('domain.ts')
  expect(buildAnatomy(project(true)).overview.domainFile).toBe('domain/domain.ts')
})
