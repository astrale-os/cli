/**
 * The shipped CLI is a Bun standalone executable, and two regressions only show inside one:
 * - `Bun.resolveSync('#schema', <domainDir>)` answers from source but throws in a
 *   `bun build --compile` binary (1.0.0-beta.60), so discovery silently rejected every
 *   Domain whose definition reaches its Schema through an alias, GRC among them;
 * - nested Bun.build captures the executable's startup cwd for package-import resolution.
 * A source-mode assertion passes either way. This compiles a tiny CLI cohort that
 * reinvokes itself exactly like `astrale studio` does, and runs it on an on-disk Domain.
 */
import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const directories: string[] = []
afterAll(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true })
})

function directory(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-standalone-'))
  directories.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

/** A Domain that reaches its Schema, and the Schema its Classes, through `#schema`. */
function aliasDomain(): string {
  const root = directory({
    'package.json': JSON.stringify({
      name: 'grc',
      type: 'module',
      imports: { '#schema': './schema/index.ts', '#schema/*': './schema/*.ts' },
    }),
    'astrale.config.ts': `import { defineProject } from '@astrale-os/sdk/project'
import domain from './domain.js'
export default defineProject({ domain })
`,
    'domain.ts': `import { defineDomain } from '@astrale-os/sdk/domain'
import { schema } from '#schema'
export default defineDomain({ schema, runtime: {} as never })
`,
    'schema/document.ts': `import { classIcon, nodeClass } from '@astrale-os/sdk/schema'
export const Document = nodeClass({ icon: classIcon.neutral, properties: {} })
`,
  })
  writeFileSync(
    join(root, 'schema/index.ts'),
    `import { defineSchema } from '@astrale-os/sdk/schema'
import { Document } from '#schema/document'
if (process.cwd() !== ${JSON.stringify(realpathSync(root))}) throw new Error('Schema evaluated outside its Domain')
export const schema = defineSchema('standalone.extractor.test', { name: 'Test Domain', classes: { Document } })
`,
  )
  const sdk = realpathSync(join(import.meta.dir, '../../node_modules/@astrale-os/sdk'))
  mkdirSync(join(root, 'node_modules/@astrale-os'), { recursive: true })
  symlinkSync(sdk, join(root, 'node_modules/@astrale-os/sdk'), 'dir')
  return root
}

function compileCliCohort(): string {
  const module = (path: string) => JSON.stringify(join(import.meta.dir, path))
  const build = directory({
    'probe.ts': `import { STUDIO_CLI_DESCRIPTOR_ENV } from ${module('cli.ts')}
const [mode, ...args] = process.argv.slice(2)
const print = (value: unknown) => process.stdout.write(JSON.stringify(value))
if (mode === '__studio-extractor') {
  process.argv.splice(2, 1)
  await import(${module('introspect/extractor.ts')})
} else if (mode === 'discover') {
  const { isDomainDir, resolveDomainEntry, resolveSchemaEntry } = await import(${module('domain/registry.ts')})
  const domain = resolveDomainEntry(args[0]!)
  print({ isDomainDir: isDomainDir(args[0]!), domain, schema: domain && resolveSchemaEntry(args[0]!, domain) })
} else {
  const { runtimeExtract } = await import(${module('introspect/runtime.ts')})
  process.env[STUDIO_CLI_DESCRIPTOR_ENV] = JSON.stringify({ version: 1, executable: process.execPath, args: [] })
  print(await runtimeExtract(args[0]!, args[1]!))
}
`,
  })
  const executable = join(build, 'probe-bin')
  const compiled = Bun.spawnSync([
    process.execPath,
    'build',
    '--compile',
    join(build, 'probe.ts'),
    '--outfile',
    executable,
  ])
  if (!compiled.success) throw new Error(`compiling the probe failed: ${compiled.stderr}`)
  return executable
}

test('a standalone executable discovers and extracts a Domain wired through #schema', () => {
  const root = aliasDomain()
  const probe = compileCliCohort()
  const run = (args: string[], cwd?: string) => {
    const result = Bun.spawnSync([probe, ...args], { cwd })
    expect(result.stderr.toString()).toBe('')
    return JSON.parse(result.stdout.toString())
  }

  expect(run(['discover', root])).toEqual({
    isDomainDir: true,
    domain: join(root, 'domain.ts'),
    schema: join(root, 'schema/index.ts'),
  })
  // the Schema resolves its own package imports and is evaluated from the Domain's cwd
  expect(run(['extract', join(root, 'schema/index.ts'), root], root)).toMatchObject({
    ok: true,
    schemaMode: 'canonical-admitted',
    root: { origin: 'standalone.extractor.test' },
    ir: { classes: { Document: { name: 'Document' } } },
  })
}, 120_000)
