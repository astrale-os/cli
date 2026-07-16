import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir)

function sourceFiles(dir = ROOT): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return sourceFiles(path)
      return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
    })
    .sort()
}

function imports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const found: string[] = []
  const pattern = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1]
    if (!specifier.startsWith('.')) continue
    const target = resolve(dirname(file), specifier)
    const candidate = target.endsWith('.ts') ? target : `${target}.ts`
    if (candidate.startsWith(ROOT)) found.push(candidate)
  }
  return found
}

function agentPath(file: string): string {
  return relative(ROOT, file).replaceAll('\\', '/')
}

test('agent concepts form an acyclic dependency graph', () => {
  const graph = new Map(sourceFiles().map((file) => [file, imports(file)]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []

  const visit = (file: string) => {
    if (visiting.has(file)) {
      const start = stack.indexOf(file)
      cycles.push([...stack.slice(start), file].map(agentPath))
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

  for (const file of graph.keys()) visit(file)
  expect(cycles).toEqual([])
})

test('leaf concepts do not depend on orchestration or HTTP ownership', () => {
  const violations: string[] = []
  for (const file of sourceFiles()) {
    const source = agentPath(file)
    for (const dependency of imports(file).map(agentPath)) {
      if (
        source.startsWith('harness/') &&
        (dependency.startsWith('run/') ||
          dependency.startsWith('bridge/') ||
          dependency.startsWith('prompts/') ||
          dependency === 'routes.ts')
      )
        violations.push(`${source} -> ${dependency}`)
      if (
        source.startsWith('prompts/') &&
        (dependency.startsWith('run/') ||
          dependency.startsWith('bridge/') ||
          dependency.startsWith('harness/') ||
          dependency === 'routes.ts')
      )
        violations.push(`${source} -> ${dependency}`)
      if (
        source.startsWith('bridge/') &&
        (dependency.startsWith('run/') ||
          dependency.startsWith('prompts/') ||
          dependency.startsWith('harness/claude/') ||
          dependency.startsWith('harness/codex/') ||
          dependency.startsWith('harness/mock/') ||
          dependency === 'routes.ts')
      )
        violations.push(`${source} -> ${dependency}`)
    }
  }
  expect(violations).toEqual([])
})
