/**
 * Discovery must behave identically in the shipped standalone executable.
 *
 * Regression guard for 1.0.0-beta.60: `Bun.resolveSync('#schema', <domainDir>)`
 * answers the authored file when Studio runs from source but throws inside a
 * `bun build --compile` binary, which resolves against its own embedded graph
 * rather than the Domain's manifest. Discovery silently rejected every Domain
 * whose Application reaches its Schema through an alias — GRC among them.
 *
 * A source-mode assertion cannot catch that: it passes either way. So this
 * compiles the real discovery module into a standalone executable and runs it
 * against an on-disk fixture, which is the exact shape that failed.
 */
import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workspaces: string[] = []

afterAll(() => {
  while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true })
})

function temporaryDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  workspaces.push(dir)
  return dir
}

/** A Domain whose Application imports its Schema through the `#schema` alias. */
function aliasDomain(): string {
  const root = temporaryDir('studio-standalone-domain-')
  mkdirSync(join(root, 'schema'))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'grc', type: 'module', imports: { '#schema': './schema/index.ts' } }),
  )
  writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
  writeFileSync(join(root, 'schema/index.ts'), 'export const schema = {}\n')
  writeFileSync(
    join(root, 'application.ts'),
    `import { defineApplication } from '@astrale-os/sdk/application'
import { schema } from '#schema'
export default defineApplication({ schema, runtime: {} as never })
`,
  )
  return root
}

/** Compile discovery into a standalone executable that reports what it resolved. */
function compileProbe(): string {
  const build = temporaryDir('studio-standalone-probe-')
  const entry = join(build, 'probe.ts')
  writeFileSync(
    entry,
    `import { isDomainDir, resolveApplicationEntry, resolveSchemaEntry } from ${JSON.stringify(join(import.meta.dir, 'domain.ts'))}
const root = process.argv[2]!
const application = resolveApplicationEntry(root)
process.stdout.write(
  JSON.stringify({
    isDomainDir: isDomainDir(root),
    application,
    schema: application === null ? null : resolveSchemaEntry(root, application),
  }),
)
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
    throw new Error(`compiling the discovery probe failed: ${compiled.stderr.toString()}`)
  }
  return executable
}

test('a standalone executable discovers a Domain that reaches its Schema through #schema', () => {
  const root = aliasDomain()
  const probed = Bun.spawnSync([compileProbe(), root])
  expect(probed.stderr.toString()).toBe('')
  expect(JSON.parse(probed.stdout.toString())).toEqual({
    isDomainDir: true,
    application: join(root, 'application.ts'),
    schema: join(root, 'schema/index.ts'),
  })
}, 120_000)
