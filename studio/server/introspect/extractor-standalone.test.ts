/**
 * The shipped CLI is a Bun standalone executable, and nested Bun.build captures
 * that executable's startup cwd for package-import resolution. Source-mode
 * extraction cannot reproduce the failure, so this test compiles a tiny CLI
 * cohort and makes it reinvoke itself exactly like `astrale studio` does.
 */
import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workspaces: string[] = []

afterAll(() => {
  while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true })
})

function temporaryDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  workspaces.push(directory)
  return directory
}

function aliasDomain(): { readonly root: string; readonly schema: string } {
  const root = temporaryDir('studio-extractor-domain-')
  const expectedCwd = realpathSync(root)
  const schemaDirectory = join(root, 'schema')
  mkdirSync(schemaDirectory)
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'standalone-extractor-fixture',
      type: 'module',
      imports: {
        '#schema': './schema/index.ts',
        '#schema/*': './schema/*.ts',
      },
    }),
  )
  const sdk = realpathSync(join(import.meta.dir, '../../../node_modules/@astrale-os/sdk'))
  const scope = join(root, 'node_modules', '@astrale-os')
  mkdirSync(scope, { recursive: true })
  symlinkSync(sdk, join(scope, 'sdk'), 'dir')
  writeFileSync(
    join(schemaDirectory, 'document.ts'),
    `import { classIcon, nodeClass } from '@astrale-os/sdk/schema'
export const Document = nodeClass({ icon: classIcon.neutral, properties: {} })
`,
  )
  const schema = join(schemaDirectory, 'index.ts')
  writeFileSync(
    schema,
    `import { defineSchema } from '@astrale-os/sdk/schema'
import { Document } from '#schema/document'
if (process.cwd() !== ${JSON.stringify(expectedCwd)}) throw new Error('Schema evaluated outside its Domain')
export const schema = defineSchema('standalone.extractor.test', {
  classes: { Document },
})
`,
  )
  return { root, schema }
}

function compileCliCohort(): string {
  const build = temporaryDir('studio-extractor-probe-')
  const entry = join(build, 'probe.ts')
  writeFileSync(
    entry,
    `import { STUDIO_CLI_DESCRIPTOR_ENV } from ${JSON.stringify(join(import.meta.dir, '../cli.ts'))}

if (process.argv[2] === '__studio-extractor') {
  process.argv.splice(2, 1)
  await import(${JSON.stringify(join(import.meta.dir, 'extractor.ts'))})
} else {
  const { runtimeExtract } = await import(${JSON.stringify(join(import.meta.dir, 'runtime.ts'))})
  process.env[STUDIO_CLI_DESCRIPTOR_ENV] = JSON.stringify({
    version: 1,
    executable: process.execPath,
    args: [],
  })
  process.stdout.write(JSON.stringify(await runtimeExtract(process.argv[2]!, process.argv[3]!)))
}
`,
  )
  const executable = join(build, 'probe-bin')
  const compiled = Bun.spawnSync([
    process.execPath,
    'build',
    '--compile',
    entry,
    '--outfile',
    executable,
  ])
  if (!compiled.success) {
    throw new Error(`compiling the extractor probe failed: ${compiled.stderr.toString()}`)
  }
  return executable
}

test('a standalone extractor resolves Domain package imports and evaluates from the Domain cwd', () => {
  const domain = aliasDomain()
  const result = Bun.spawnSync([compileCliCohort(), domain.schema, domain.root], {
    cwd: domain.root,
  })
  expect(result.stderr.toString()).toBe('')
  expect(JSON.parse(result.stdout.toString())).toMatchObject({
    ok: true,
    schemaMode: 'canonical-admitted',
    root: { origin: 'standalone.extractor.test' },
    ir: { classes: { Document: { name: 'Document' } } },
  })
}, 120_000)
