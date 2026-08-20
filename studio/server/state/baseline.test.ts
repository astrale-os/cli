import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hashAnatomyFiles } from './baseline'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('hashes current implementation and semantic layer files alongside legacy anatomy', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-current-baseline-'))
  roots.push(root)
  for (const dir of [
    'schema',
    'actions/risk',
    'handlers/risk',
    'queries/risk',
    'ui/risk',
    'views/risk',
  ]) {
    mkdirSync(join(root, dir), { recursive: true })
  }
  for (const file of [
    'schema/index.ts',
    'implementation.ts',
    'actions/risk/index.ts',
    'handlers/risk/index.ts',
    'queries/risk/index.ts',
    'ui/risk/screen.tsx',
    'views/risk/index.ts',
    'package.json',
  ]) {
    writeFileSync(join(root, file), `${file}\n`)
  }
  writeFileSync(join(root, 'README.md'), 'not part of the anatomy fileset\n')

  expect(Object.keys(hashAnatomyFiles(root, 'schema')).sort()).toEqual([
    'actions/risk/index.ts',
    'handlers/risk/index.ts',
    'implementation.ts',
    'package.json',
    'queries/risk/index.ts',
    'schema/index.ts',
    'ui/risk/screen.tsx',
    'views/risk/index.ts',
  ])
})
