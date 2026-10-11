import { afterEach, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SCAFFOLDER } from '../../../src/lib/scaffolder'
import { annotateOrigin, createDomain } from './create'
import { initWorkspaceRoot, workspaceRoot } from './root'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('workspace creation annotates the schema definition behind a current barrel', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-create-origin-'))
  roots.push(root)
  mkdirSync(join(root, 'schema', 'application'), { recursive: true })
  const barrel = join(root, 'schema', 'index.ts')
  const definition = join(root, 'schema', 'application', 'index.ts')
  writeFileSync(barrel, `export { schema } from './application/index.js'\n`)
  writeFileSync(
    definition,
    `export const ORIGIN = 'application.example.dev' as const
const input = { name: 'Test Domain', classes: {} } as const
export const schema = defineSchema(ORIGIN, input)
`,
  )

  annotateOrigin(root)
  annotateOrigin(root)

  expect(readFileSync(barrel, 'utf8')).not.toContain('ORIGIN —')
  const source = readFileSync(definition, 'utf8')
  expect(source).toContain('// ORIGIN —')
  expect(source.indexOf('// ORIGIN —')).toBeLessThan(source.indexOf('defineSchema(ORIGIN'))
  expect(source.match(/\/\/ ORIGIN —/g)).toHaveLength(1)
})

test('creation refuses a bad name or a taken folder, scaffolds with no instance, and reports a refusal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-create-'))
  roots.push(root)
  mkdirSync(join(root, 'taken'))
  // an npx that records its argv and refuses, so nothing is fetched or scaffolded
  const bin = join(root, '.bin')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'npx'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(root, 'argv')}"\necho 'scaffold refused'\nexit 1\n`,
  )
  chmodSync(join(bin, 'npx'), 0o755)
  const previous = { root: workspaceRoot(), path: process.env.PATH }
  initWorkspaceRoot(root)
  process.env.PATH = `${bin}:${previous.path}`
  try {
    for (const name of ['../escape', '.hidden', 'Two words'])
      expect(await createDomain(name)).toMatchObject({ ok: false, output: '' })
    expect((await createDomain('taken')).error).toContain('already exists')

    expect(await createDomain('crm')).toMatchObject({ ok: false, output: 'scaffold refused' })
    // the shared scaffolder range, non-interactive, naming no instance
    expect(readFileSync(join(root, 'argv'), 'utf8').trim().split('\n')).toEqual([
      '--yes',
      SCAFFOLDER,
      'crm',
      '--yes',
    ])
  } finally {
    initWorkspaceRoot(previous.root)
    process.env.PATH = previous.path
  }
})
