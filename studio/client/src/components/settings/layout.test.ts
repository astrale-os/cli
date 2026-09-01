import { expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir)

function sourceFiles(dir = ROOT): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return sourceFiles(path)
      return /\.(?:ts|tsx)$/.test(path) && !/\.test\.(?:ts|tsx)$/.test(path) ? [path] : []
    })
    .sort()
}

function resolveImport(file: string, specifier: string): string | null {
  const target = specifier.startsWith('@/components/settings/')
    ? resolve(ROOT, specifier.slice('@/components/settings/'.length))
    : resolve(dirname(file), specifier)
  for (const candidate of [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    join(target, 'index.ts'),
    join(target, 'index.tsx'),
  ])
    if (sourceFiles().includes(candidate)) return candidate
  return null
}

function imports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const found: string[] = []
  const pattern = /(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]\s*\)?|import\s+['"]([^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2]
    if (!specifier.startsWith('.') && !specifier.startsWith('@/components/settings/')) continue
    const target = resolveImport(file, specifier)
    if (target?.startsWith(ROOT)) found.push(target)
  }
  return found
}

const settingsPath = (file: string) => relative(ROOT, file).replaceAll('\\', '/')

test('settings modules form an acyclic dependency graph', () => {
  const files = sourceFiles()
  const graph = new Map(files.map((file) => [file, imports(file)]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []

  const visit = (file: string) => {
    if (visiting.has(file)) {
      const start = stack.indexOf(file)
      cycles.push([...stack.slice(start), file].map((path) => basename(path)))
      return
    }
    if (visited.has(file)) return
    visiting.add(file)
    stack.push(file)
    for (const dependency of graph.get(file) ?? []) if (graph.has(dependency)) visit(dependency)
    stack.pop()
    visiting.delete(file)
    visited.add(file)
  }

  for (const file of files) visit(file)
  expect(cycles).toEqual([])
})

test('leaf settings controls do not depend on composition', () => {
  const leaves = new Set([
    'agent-model.tsx',
    'agent-pickers.tsx',
    'agent-session.tsx',
    'gateway-auth.tsx',
    'gateway-fields.tsx',
    'gateway-validation.ts',
    'hint.tsx',
  ])
  const forbidden = new Set(['agent.tsx', 'dialog.tsx', 'gateway.tsx', 'loadout.tsx'])
  const violations = sourceFiles().flatMap((file) => {
    const source = settingsPath(file)
    if (!leaves.has(source)) return []
    return imports(file)
      .map(settingsPath)
      .filter((dependency) => forbidden.has(dependency))
      .map((dependency) => `${source} -> ${dependency}`)
  })
  expect(violations).toEqual([])
})

test('the historical SettingsDialog import is a pure compatibility entry', () => {
  const entry = readFileSync(join(ROOT, '..', 'settings-dialog.tsx'), 'utf8').trim()
  expect(entry).toBe("export { SettingsDialog } from './settings/dialog'")
})
