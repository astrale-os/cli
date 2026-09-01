import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isPackageImportSpecifier, resolvePackageImport } from './package-imports'

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

describe('authored package `imports` resolution', () => {
  test('resolves an exact alias to its manifest target', () => {
    const root = project({ '#schema': './schema/index.ts' })
    expect(resolvePackageImport('#schema', root)).toEqual([join(root, 'schema/index.ts')])
  })

  test('resolves an alias from a nested authored file, not just the package root', () => {
    const root = project({ '#schema': './schema/index.ts' }, ['src/deep'])
    expect(resolvePackageImport('#schema', join(root, 'src/deep'))).toEqual([
      join(root, 'schema/index.ts'),
    ])
  })

  test('substitutes the matched segment into a wildcard target', () => {
    const root = project({ '#actions/*': './actions/*.ts' })
    expect(resolvePackageImport('#actions/risk', root)).toEqual([join(root, 'actions/risk.ts')])
  })

  test('prefers the exact key, then the most specific pattern', () => {
    const root = project({
      '#schema/*': './generic/*',
      '#schema/kernel/*': './kernel/*',
      '#schema': './schema/index.ts',
    })
    expect(resolvePackageImport('#schema', root)).toEqual([join(root, 'schema/index.ts')])
    expect(resolvePackageImport('#schema/kernel/graph.ts', root)).toEqual([
      join(root, 'kernel/graph.ts'),
    ])
    expect(resolvePackageImport('#schema/other.ts', root)).toEqual([join(root, 'generic/other.ts')])
  })

  test('reads conditional targets in declaration order and keeps array fallbacks', () => {
    const root = project({
      '#schema': { bun: './schema/index.ts', default: './dist/schema/index.js' },
      '#legacy': ['./first.ts', './second.ts'],
    })
    expect(resolvePackageImport('#schema', root)).toEqual([
      join(root, 'schema/index.ts'),
      join(root, 'dist/schema/index.js'),
    ])
    expect(resolvePackageImport('#legacy', root)).toEqual([
      join(root, 'first.ts'),
      join(root, 'second.ts'),
    ])
  })

  test('ignores conditions this resolution does not activate', () => {
    const root = project({ '#schema': { require: './cjs/schema.cjs', types: './schema.d.ts' } })
    expect(resolvePackageImport('#schema', root)).toEqual([])
  })

  test('declines aliases onto external packages and unmapped specifiers', () => {
    const root = project({ '#sdk': '@astrale-os/sdk/schema', '#schema': './schema/index.ts' })
    expect(resolvePackageImport('#sdk', root)).toEqual([])
    expect(resolvePackageImport('#missing', root)).toEqual([])
  })

  test('declines targets that climb out of the package or through node_modules', () => {
    const root = project({
      '#escape': './../outside.ts',
      '#up': './schema/../../outside.ts',
      '#vendored': './node_modules/pkg/index.js',
      '#absolute': '/etc/passwd',
    })
    for (const alias of ['#escape', '#up', '#vendored', '#absolute']) {
      expect(resolvePackageImport(alias, root)).toEqual([])
    }
  })

  test('declines a wildcard match that walks the target out of the package', () => {
    const root = project({ '#actions/*': './actions/*.ts' })
    expect(resolvePackageImport('#actions/../../outside', root)).toEqual([])
  })

  test('declines specifiers the spec reserves', () => {
    expect(isPackageImportSpecifier('#schema')).toBe(true)
    expect(isPackageImportSpecifier('#')).toBe(false)
    expect(isPackageImportSpecifier('#/schema')).toBe(false)
    expect(isPackageImportSpecifier('./schema')).toBe(false)
  })

  test('stops at the nearest manifest instead of borrowing an outer one', () => {
    const root = project({ '#schema': './schema/index.ts' }, ['packages/inner'])
    const inner = join(root, 'packages/inner')
    writeFileSync(join(inner, 'package.json'), JSON.stringify({ name: 'inner', type: 'module' }))
    // The Domain's own runtime would reject `#schema` here, so Studio must too.
    expect(resolvePackageImport('#schema', inner)).toEqual([])
  })

  test('survives a manifest that is unreadable or has no imports map', () => {
    const broken = mkdtempSync(join(tmpdir(), 'studio-package-imports-broken-'))
    roots.push(broken)
    writeFileSync(join(broken, 'package.json'), '{ not json')
    expect(resolvePackageImport('#schema', broken)).toEqual([])
    expect(resolvePackageImport('#schema', project({}))).toEqual([])
  })
})
