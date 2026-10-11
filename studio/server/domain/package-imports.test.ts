import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolvePackageImport } from './package-imports'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

/** A package root whose manifest carries `imports`, plus optional nested dirs. */
function project(imports: unknown, dirs: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-package-imports-'))
  roots.push(root)
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'grc', type: 'module', imports }),
  )
  for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true })
  return root
}

test('resolves exact keys first, then the most specific pattern, from any nested file', () => {
  const root = project(
    {
      '#schema/*': './generic/*',
      '#schema/kernel/*': './kernel/*',
      '#schema': './schema/index.ts',
      '#functions/*': './functions/*.ts',
    },
    ['src/deep'],
  )
  const resolve = (specifier: string) => resolvePackageImport(specifier, join(root, 'src/deep'))
  expect(resolve('#schema')).toEqual([join(root, 'schema/index.ts')])
  expect(resolve('#schema/kernel/graph.ts')).toEqual([join(root, 'kernel/graph.ts')])
  expect(resolve('#schema/other.ts')).toEqual([join(root, 'generic/other.ts')])
  expect(resolve('#functions/risk')).toEqual([join(root, 'functions/risk.ts')])
})

test('reads active conditions in declaration order and keeps array fallbacks', () => {
  const root = project({
    '#schema': { bun: './schema/index.ts', require: './cjs.cjs', default: './dist/index.js' },
    '#fallback': ['./first.ts', './second.ts'],
    '#types': { types: './schema.d.ts' },
  })
  expect(resolvePackageImport('#schema', root)).toEqual([
    join(root, 'schema/index.ts'),
    join(root, 'dist/index.js'),
  ])
  expect(resolvePackageImport('#fallback', root)).toEqual([
    join(root, 'first.ts'),
    join(root, 'second.ts'),
  ])
  expect(resolvePackageImport('#types', root)).toEqual([])
})

test('never resolves outside the package, through node_modules, or onto another package', () => {
  const root = project({
    '#escape': './../outside.ts',
    '#up': './schema/../../outside.ts',
    '#vendored': './node_modules/pkg/index.js',
    '#absolute': '/etc/passwd',
    '#sdk': '@astrale-os/sdk/schema',
    '#functions/*': './functions/*.ts',
  })
  for (const alias of ['#escape', '#up', '#vendored', '#absolute', '#sdk', '#missing', '#'])
    expect(resolvePackageImport(alias, root)).toEqual([])
  expect(resolvePackageImport('#functions/../../outside', root)).toEqual([])
})

test('stops at the nearest manifest, and survives one that is unreadable', () => {
  const root = project({ '#schema': './schema/index.ts' }, ['packages/inner'])
  const inner = join(root, 'packages/inner')
  writeFileSync(join(inner, 'package.json'), JSON.stringify({ name: 'inner', type: 'module' }))
  // the Domain's own runtime would reject `#schema` here, so Studio must too
  expect(resolvePackageImport('#schema', inner)).toEqual([])
  writeFileSync(join(inner, 'package.json'), '{ not json')
  expect(resolvePackageImport('#schema', inner)).toEqual([])
})
