import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  decodeJsonObject,
  runStudioCliJson,
  STUDIO_CLI_DESCRIPTOR_ENV,
  studioCliCommand,
} from './cli'

const priorDescriptor = process.env[STUDIO_CLI_DESCRIPTOR_ENV]
const roots: string[] = []

afterEach(() => {
  if (priorDescriptor === undefined) delete process.env[STUDIO_CLI_DESCRIPTOR_ENV]
  else process.env[STUDIO_CLI_DESCRIPTOR_ENV] = priorDescriptor
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('exact command rejects missing and incompatible descriptors instead of using PATH', () => {
  delete process.env[STUDIO_CLI_DESCRIPTOR_ENV]
  expect(() => studioCliCommand(['instance', 'active'])).toThrow(
    'launch Studio through this Astrale CLI',
  )
  expect(() =>
    studioCliCommand(
      ['instance', 'active'],
      JSON.stringify({ version: 2, executable: '/usr/bin/astrale', args: [] }),
    ),
  ).toThrow('launch Studio through this Astrale CLI')
})

test('machine runner uses the exact descriptor, appends json mode, and versions decoded output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-cli-runner-'))
  roots.push(root)
  mkdirSync(root, { recursive: true })
  const entry = join(root, 'fake-cli.ts')
  writeFileSync(entry, `process.stdout.write(JSON.stringify({ command: process.argv.slice(2) }))\n`)
  process.env[STUDIO_CLI_DESCRIPTOR_ENV] = JSON.stringify({
    version: 1,
    executable: process.execPath,
    args: [realpathSync(entry)],
  })

  const result = await runStudioCliJson(
    ['query', '--definition', '/:example.dev:class.Issue'],
    decodeJsonObject,
  )

  expect(result).toMatchObject({
    version: 1,
    ok: true,
    exitCode: 0,
    timedOut: false,
    data: {
      command: ['query', '--definition', '/:example.dev:class.Issue', '--json'],
    },
  })
})

test('machine runner decodes structured CLI errors without treating them as success', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-cli-error-'))
  roots.push(root)
  const entry = join(root, 'fake-cli.ts')
  writeFileSync(
    entry,
    `process.stderr.write(JSON.stringify({ error: 'NOT_FOUND', message: 'Missing instance.' }))
process.exit(7)
`,
  )
  process.env[STUDIO_CLI_DESCRIPTOR_ENV] = JSON.stringify({
    version: 1,
    executable: process.execPath,
    args: [realpathSync(entry)],
  })

  const result = await runStudioCliJson(['instance', 'active'], decodeJsonObject)

  expect(result).toMatchObject({
    version: 1,
    ok: false,
    exitCode: 7,
    detail: 'Missing instance.',
    data: { error: 'NOT_FOUND', message: 'Missing instance.' },
  })
})
