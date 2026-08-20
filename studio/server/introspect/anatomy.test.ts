import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildAnatomy } from './anatomy'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function project(entry: 'implementation.ts' | 'domain.ts') {
  const root = mkdtempSync(join(tmpdir(), 'studio-anatomy-entry-'))
  roots.push(root)
  mkdirSync(join(root, 'schema'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{}\n')
  writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
  writeFileSync(join(root, entry), 'export const domain = {}\n')
  writeFileSync(join(root, 'schema/index.ts'), "defineSchema('example.astrale.ai', {})\n")
  return root
}

test('overview anchors current projects to implementation.ts', () => {
  const anatomy = buildAnatomy({ root: project('implementation.ts'), schemaDirName: 'schema' })
  expect(anatomy.overview.compositionFile).toBe('implementation.ts')
})

test('overview preserves domain.ts as the legacy composition entry', () => {
  const anatomy = buildAnatomy({ root: project('domain.ts'), schemaDirName: 'schema' })
  expect(anatomy.overview.compositionFile).toBe('domain.ts')
})
