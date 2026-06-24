import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

/** Base package of a bare specifier: `@scope/pkg/sub` → `@scope/pkg`, `pkg/sub` → `pkg`. */
function basePackage(spec: string): string {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

function isBuiltin(spec: string): boolean {
  return spec.startsWith('node:') || spec === 'bun' || spec.startsWith('bun:')
}

describe('studio server runtime deps', () => {
  const deps = new Set(
    Object.keys(
      (
        JSON.parse(readFileSync(join(CLI_ROOT, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, string>
        }
      ).dependencies ?? {},
    ),
  )

  const project = new Project({ skipAddingFilesFromTsConfig: true })
  project.addSourceFilesAtPaths([
    join(CLI_ROOT, 'studio/server/**/*.ts'),
    join(CLI_ROOT, 'studio/shared/**/*.ts'),
  ])

  // getImportStringLiterals covers static imports, re-exports, and dynamic import().
  const offenders: Record<string, string[]> = {}
  for (const sf of project.getSourceFiles()) {
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

  test('parsed at least the known studio server files', () => {
    // Guard against the glob silently matching nothing (which would make the
    // invariant vacuously pass).
    expect(project.getSourceFiles().length).toBeGreaterThan(10)
  })
})
