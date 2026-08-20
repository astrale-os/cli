import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { annotateOrigin } from './create'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('annotates the schema definition behind a current barrel', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-create-origin-'))
  roots.push(root)
  mkdirSync(join(root, 'schema', 'application'), { recursive: true })
  const barrel = join(root, 'schema', 'index.ts')
  const definition = join(root, 'schema', 'application', 'index.ts')
  writeFileSync(barrel, `export { schema } from './application/index.js'\n`)
  writeFileSync(
    definition,
    `export const ORIGIN = 'application.example.dev' as const
const input = { classes: {} } as const
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
