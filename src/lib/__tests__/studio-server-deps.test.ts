import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Project } from 'ts-morph'

/**
 * The Domain Studio SERVER ships as raw source inside the published CLI package
 * (package.json `files`: studio/server, studio/shared) and runs UNBUNDLED under
 * Bun — unlike the CLI itself, which is bundled into dist/astrale.js with all its
 * deps inlined. So at `astrale studio` runtime, the server can only resolve the
 * third-party packages that the CLI declares in its own `dependencies` (the
 * studio's package.json deps are NOT installed for an `npm i -g @astrale-os/cli`
 * consumer — they're client/build-only, inlined into studio/client/dist).
 *
 * This test enforces that invariant. If it fails, either add the package to the
 * CLI's `dependencies` or drop the import — do NOT add it to studio/package.json
 * (that won't ship to npm consumers).
 */

const CLI_ROOT = new URL('../../../', import.meta.url).pathname

interface PackageManifest {
  dependencies?: Record<string, string>
  scripts?: Record<string, string>
}

const cliPackage = JSON.parse(
  readFileSync(join(CLI_ROOT, 'package.json'), 'utf8'),
) as PackageManifest
const studioPackage = JSON.parse(
  readFileSync(join(CLI_ROOT, 'studio/package.json'), 'utf8'),
) as PackageManifest

/** Base package of a bare specifier: `@scope/pkg/sub` → `@scope/pkg`, `pkg/sub` → `pkg`. */
function basePackage(spec: string): string {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

function isBuiltin(spec: string): boolean {
  return spec.startsWith('node:') || spec === 'bun' || spec.startsWith('bun:')
}

function runtimeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return runtimeFiles(path)
    return /\.(?:ts|tsx)$/.test(path) && !/\.test\.(?:ts|tsx)$/.test(path) ? [path] : []
  })
}

const studioPath = (path: string) => relative(CLI_ROOT, path).replaceAll('\\', '/')

describe('studio server runtime deps', () => {
  const deps = new Set(Object.keys(cliPackage.dependencies ?? {}))

  const project = new Project({ skipAddingFilesFromTsConfig: true })
  project.addSourceFilesAtPaths([
    join(CLI_ROOT, 'studio/server/**/*.ts'),
    join(CLI_ROOT, 'studio/server/**/*.tsx'),
    join(CLI_ROOT, 'studio/shared/**/*.ts'),
    join(CLI_ROOT, 'studio/shared/**/*.tsx'),
  ])
  const runtimeSourceFiles = project
    .getSourceFiles()
    .filter((sourceFile) => !/\.test\.(?:ts|tsx)$/.test(sourceFile.getBaseName()))

  // getImportStringLiterals covers static imports, re-exports, and dynamic import().
  const offenders: Record<string, string[]> = {}
  for (const sf of runtimeSourceFiles) {
    const specs = sf.getImportStringLiterals().map((l) => l.getLiteralValue())
    for (const spec of specs) {
      if (spec.startsWith('.') || spec.startsWith('/') || isBuiltin(spec)) continue
      const pkg = basePackage(spec)
      if (!deps.has(pkg)) (offenders[pkg] ??= []).push(sf.getFilePath().replace(CLI_ROOT, ''))
    }
  }

  test('only import Node/Bun builtins or packages in the CLI dependencies', () => {
    expect(
      offenders,
      `studio server imports packages NOT in the CLI's package.json dependencies — ` +
        `they won't be installed for an \`npm i -g @astrale-os/cli\` consumer:\n` +
        JSON.stringify(offenders, null, 2),
    ).toEqual({})
  })

  test('parses every shipped Studio server and shared runtime source', () => {
    const expected = [
      ...runtimeFiles(join(CLI_ROOT, 'studio/server')),
      ...runtimeFiles(join(CLI_ROOT, 'studio/shared')),
    ]
      .map(studioPath)
      .sort()
    const parsed = runtimeSourceFiles
      .map((sourceFile) => studioPath(sourceFile.getFilePath()))
      .sort()

    expect(parsed).toEqual(expected)
  })
})

describe('studio test gate', () => {
  test('the root and Studio suites include all client, server, and shared tests', () => {
    expect(cliPackage.scripts?.test).toBe(
      'pnpm run check:cohort && bun test src studio/client/src studio/server studio/shared && node --test scripts/*.test.mjs scripts/cohort/__tests__/*.test.mjs',
    )
    expect(cliPackage.scripts?.['test:studio']).toBe('pnpm --dir studio test')
    expect(studioPackage.scripts?.test).toBe('bun test client/src server shared')
  })
})
