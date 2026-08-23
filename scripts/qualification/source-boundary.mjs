import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const flags = new Set(process.argv.slice(2))
const target = flags.has('--target')
const write = flags.has('--write')

const files = git('ls-files', '-co', '--exclude-standard')
  .split('\n')
  .filter(Boolean)
  .filter((path) => existsSync(resolve(root, path)))
  .filter((path) => /^(?:bin|scripts|src|studio|viewer|\.spec)\//u.test(path))
  .filter((path) => /\.(?:c?m?js|ts|tsx)$/u.test(path))
  .sort(compare)

const tests = files.filter(isTest)
const specifications = files.filter((path) => path.includes('/.spec/') || path.startsWith('.spec/'))
const production = files.filter((path) => !isTest(path) && !specifications.includes(path))
const sdkImports = new Map()
const kernelImports = new Map()
const legacy = []
const interfaceEra = []
const auditPath = 'scripts/qualification/source-boundary.mjs'

const legacySpecifiers = new Set([
  '@astrale-os/sdk/domain',
  '@astrale-os/sdk/graph/model',
  '@astrale-os/sdk/schema/kernel',
])
const legacyTokens = [
  ['ClassPath', /\bClassPath\b/u],
  ['Domain.fromSchema', /\bDomain\.fromSchema\b/u],
  ['flat DomainBinding', /\bbinding\.\$/u],
  ['Key.ref', /\bKey\.ref\b/u],
  ['QueryDefinitionRef', /\bQueryDefinitionRef\b/u],
  ['schemaRef', /\bschemaRef\b/u],
]
const interfaceTokens = [
  ['interface definition kind', /['"]interface['"]/u],
  ['interface namespace', /\.interfaces\b/u],
  ['interfaces field', /\binterfaces\s*:/u],
]

for (const path of files) {
  const source = readFileSync(resolve(root, path), 'utf8')
  for (const match of source.matchAll(
    /\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  )) {
    const specifier = match[1] ?? match[2]
    if (specifier?.startsWith('@astrale-os/sdk')) {
      sdkImports.set(specifier, (sdkImports.get(specifier) ?? 0) + 1)
      if (legacySpecifiers.has(specifier))
        legacy.push(location(path, source, match.index, specifier))
    }
    if (specifier?.startsWith('@astrale-os/kernel-')) {
      kernelImports.set(specifier, (kernelImports.get(specifier) ?? 0) + 1)
    }
  }
  if (path === auditPath || (!production.includes(path) && !specifications.includes(path))) continue
  for (const [name, pattern] of legacyTokens) {
    for (const match of source.matchAll(new RegExp(pattern.source, 'gu'))) {
      legacy.push(location(path, source, match.index, name))
    }
  }
  for (const [name, pattern] of interfaceTokens) {
    for (const match of source.matchAll(new RegExp(pattern.source, 'gu'))) {
      interfaceEra.push(location(path, source, match.index, name))
    }
  }
}

const inventory = {
  version: 1,
  head: git('rev-parse', 'HEAD'),
  counts: {
    productionFiles: production.length,
    productionLines: lines(production),
    testFiles: tests.length,
    testLines: lines(tests),
    specificationFiles: specifications.length,
    specificationLines: lines(specifications),
  },
  sdkImports: sortedRecord(sdkImports),
  kernelImports: sortedRecord(kernelImports),
  legacy: uniqueLocations(legacy),
  interfaceEra: uniqueLocations(interfaceEra),
}

const rendered = `${JSON.stringify(inventory, null, 2)}\n`
if (write) writeFileSync(resolve(root, '.history/sdk-v1-migration/inventory.json'), rendered)
process.stdout.write(rendered)

if (target && legacy.length > 0) {
  process.stderr.write('CLI SDK V1 target rejected: legacy SDK/Domain surfaces remain.\n')
  process.exitCode = 1
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function isTest(path) {
  return path.includes('/__tests__/') || /\.(?:test|spec)(?:-d)?\.(?:c?m?js|ts|tsx)$/u.test(path)
}

function lines(paths) {
  return paths.reduce((total, path) => {
    const source = readFileSync(resolve(root, path), 'utf8')
    return total + (source.length === 0 ? 0 : source.split(/\r?\n/u).length)
  }, 0)
}

function location(path, source, offset, token) {
  return { path, line: source.slice(0, offset).split(/\r?\n/u).length, token }
}

function uniqueLocations(locations) {
  const values = new Map()
  for (const value of locations) values.set(`${value.path}:${value.line}:${value.token}`, value)
  return [...values.values()].sort((left, right) =>
    compare(
      `${left.path}:${left.line}:${left.token}`,
      `${right.path}:${right.line}:${right.token}`,
    ),
  )
}

function sortedRecord(values) {
  return Object.fromEntries([...values].sort(([left], [right]) => compare(left, right)))
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}
