import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const STUDIO_ROOT = resolve(import.meta.dir, '..')
const CLIENT_ROOT = join(STUDIO_ROOT, 'client', 'src')
const SERVER_ROOT = join(STUDIO_ROOT, 'server')
const SHARED_ROOT = join(STUDIO_ROOT, 'shared')
const STATE_ROOT = join(SERVER_ROOT, 'state')

function productionFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return productionFiles(path)
      if (!/\.(?:ts|tsx)$/.test(path) || /\.test\.(?:ts|tsx)$/.test(path)) return []
      return [path]
    })
    .sort()
}

const files = [
  ...productionFiles(CLIENT_ROOT),
  ...productionFiles(SERVER_ROOT),
  ...productionFiles(SHARED_ROOT),
]
const fileSet = new Set(files)

function resolveLocalImport(file: string, specifier: string): string | null {
  const target = specifier.startsWith('@/')
    ? join(CLIENT_ROOT, specifier.slice(2))
    : specifier.startsWith('@shared/')
      ? join(SHARED_ROOT, specifier.slice('@shared/'.length))
      : specifier.startsWith('.')
        ? resolve(dirname(file), specifier)
        : null
  if (!target) return null
  for (const candidate of [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    join(target, 'index.ts'),
    join(target, 'index.tsx'),
  ]) {
    if (fileSet.has(candidate)) return candidate
  }
  return null
}

function imports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const found: string[] = []
  const pattern = /(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]\s*\)?|import\s+['"]([^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) {
    const target = resolveLocalImport(file, match[1] ?? match[2])
    if (target) found.push(target)
  }
  return found
}

const studioPath = (file: string) => relative(STUDIO_ROOT, file).replaceAll('\\', '/')

test('Studio production modules form an acyclic dependency graph', () => {
  const graph = new Map(files.map((file) => [file, imports(file)]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []

  const visit = (file: string) => {
    if (visiting.has(file)) {
      const start = stack.indexOf(file)
      cycles.push([...stack.slice(start), file].map(studioPath))
      return
    }
    if (visited.has(file)) return
    visiting.add(file)
    stack.push(file)
    for (const dependency of graph.get(file) ?? []) visit(dependency)
    stack.pop()
    visiting.delete(file)
    visited.add(file)
  }

  for (const file of files) visit(file)
  expect(cycles).toEqual([])
})

test('production boundaries keep client and server separate with shared depending on neither', () => {
  const violations = files.flatMap((file) =>
    imports(file)
      .filter(
        (dependency) =>
          (file.startsWith(CLIENT_ROOT) && dependency.startsWith(SERVER_ROOT)) ||
          (file.startsWith(SERVER_ROOT) && dependency.startsWith(CLIENT_ROOT)) ||
          (file.startsWith(SHARED_ROOT) &&
            (dependency.startsWith(CLIENT_ROOT) || dependency.startsWith(SERVER_ROOT))),
      )
      .map((dependency) => `${studioPath(file)} -> ${studioPath(dependency)}`),
  )
  expect(violations).toEqual([])
})

test('state repositories do not depend on workflow modules', () => {
  const workflowRoots = ['api', 'environment', 'handoff', 'instances', 'views', 'workspace'].map(
    (directory) => join(SERVER_ROOT, directory),
  )
  const edges = files
    .filter((file) => file.startsWith(STATE_ROOT))
    .flatMap((file) =>
      imports(file)
        .filter((dependency) => workflowRoots.some((root) => dependency.startsWith(root)))
        .map((dependency) => `${studioPath(file)} -> ${studioPath(dependency)}`),
    )

  expect(edges).toEqual([])
})
