import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SCAFFOLDER, SCAFFOLDER_RANGE } from '../../../src/lib/scaffolder'
import { initWorkspaceState, workspaceRoot } from '../workspace-state'
import { annotateOrigin, createDomain, scaffoldArgs } from './create'

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

test('workspace creation scaffolds from the shared range without --instance', () => {
  expect(scaffoldArgs('crm')).toEqual([
    '--yes',
    `create-astrale-domain@${SCAFFOLDER_RANGE}`,
    'crm',
    '--yes',
  ])
  expect(scaffoldArgs('crm')).toContain(SCAFFOLDER)
})

test('workspace creation runs exactly that argv, and names no instance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-create-argv-'))
  roots.push(root)
  const previous = workspaceRoot()
  initWorkspaceState(root)
  const calls: { cmd: string; args: string[]; cwd: string }[] = []
  try {
    const result = await createDomain('crm', {
      run: async (cmd, args, cwd) => {
        calls.push({ cmd, args, cwd })
        return { code: 1, output: 'scaffold refused' }
      },
    })

    expect(calls).toEqual([{ cmd: 'npx', args: scaffoldArgs('crm'), cwd: root }])
    expect(calls[0]!.args.some((arg) => arg.startsWith('--instance'))).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.output).toBe('scaffold refused')
  } finally {
    initWorkspaceState(previous)
  }
})
