import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const STUDIO_ROOT = resolve(import.meta.dir, '..')
const CLIENT_ROOT = join(STUDIO_ROOT, 'client', 'src')
const SERVER_ROOT = join(STUDIO_ROOT, 'server')
const SHARED_ROOT = join(STUDIO_ROOT, 'shared')

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return productionFiles(path)
    return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : []
  })
}

const files = [CLIENT_ROOT, SERVER_ROOT, SHARED_ROOT].flatMap(productionFiles)
const fileSet = new Set(files)

/** The Studio files `file` imports, statically or dynamically, through the Studio aliases. */
function imports(file: string): string[] {
  const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true)
  return importedFiles.flatMap(({ fileName }) => {
    const target = fileName.startsWith('@/')
      ? join(CLIENT_ROOT, fileName.slice(2))
      : fileName.startsWith('@shared/')
        ? join(SHARED_ROOT, fileName.slice('@shared/'.length))
        : fileName.startsWith('.')
          ? resolve(dirname(file), fileName)
          : null
    if (!target) return []
    const found = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
      .map((suffix) => target + suffix)
      .find((candidate) => fileSet.has(candidate))
    return found ? [found] : []
  })
}

const studioPath = (file: string) => relative(STUDIO_ROOT, file).replaceAll('\\', '/')
const graph = new Map(files.map((file) => [file, imports(file)]))

test('Studio production modules form an acyclic dependency graph', () => {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []
  const visit = (file: string) => {
    if (visiting.has(file)) {
      cycles.push([...stack.slice(stack.indexOf(file)), file].map(studioPath))
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

test('client and server stay apart, and shared depends on neither', () => {
  const crosses = (from: string, to: string) =>
    (from.startsWith(CLIENT_ROOT) && to.startsWith(SERVER_ROOT)) ||
    (from.startsWith(SERVER_ROOT) && to.startsWith(CLIENT_ROOT)) ||
    (from.startsWith(SHARED_ROOT) && !to.startsWith(SHARED_ROOT))
  const violations = [...graph].flatMap(([file, dependencies]) =>
    dependencies
      .filter((dependency) => crosses(file, dependency))
      .map((dependency) => `${studioPath(file)} -> ${studioPath(dependency)}`),
  )
  expect(violations).toEqual([])
})
