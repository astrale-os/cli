import { Glob } from 'bun'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'

import { cliRuns, observeConnections, runCli } from '../../commands/__tests__/fixtures/process'

const cliRoot = join(import.meta.dir, '../../..')

/** A bare `Error` construction or call, which no user-facing code can tell apart from a bug. */
const UNTYPED_ERROR = /(?<![\w$.])(?:new\s+)?Error\s*\(/u

/** Modules the browser viewer bundles: they run in the page, outside the CLI process and its report. */
async function browserModules(): Promise<ReadonlySet<string>> {
  const modules = new Set<string>()
  for await (const file of new Glob('viewer/*.ts').scan(cliRoot)) {
    const source = await readFile(join(cliRoot, file), 'utf8')
    for (const [, specifier] of source.matchAll(/from '(\.\.\/src\/[^']+)'/gu)) {
      modules.add(`${normalize(join('viewer', specifier!))}.ts`)
    }
  }
  return modules
}

/** @evidence TEST-CLI-PROGRAM-NO-UNTYPED-ERRORS */
test('CLI process code constructs no bare Error: a refusal is typed, a broken invariant is an InternalError', async () => {
  const browser = await browserModules()
  const untyped: string[] = []
  for await (const file of new Glob('{bin,src}/**/*.ts').scan(cliRoot)) {
    if (/(^|\/)(__tests__|\.spec|generated)\//u.test(file) || browser.has(file)) continue
    const lines = (await readFile(join(cliRoot, file), 'utf8')).split('\n')
    lines.forEach((line, index) => {
      if (UNTYPED_ERROR.test(line)) untyped.push(`${file}:${index + 1}: ${line.trim()}`)
    })
  }
  expect(browser.size).toBeGreaterThan(0)
  expect(untyped).toEqual([])
})

let home = ''
let fileHome = ''

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'astrale-typed-failures-'))
  const parent = await mkdtemp(join(tmpdir(), 'astrale-file-home-'))
  fileHome = join(parent, 'home')
  await writeFile(fileHome, 'not a directory\n')
})

afterAll(async () => {
  await rm(home, { recursive: true, force: true })
  await rm(join(fileHome, '..'), { recursive: true, force: true })
})

/** Every path under `root`, so a refusal can be shown to leave the home exactly as it was. */
async function tree(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true })).sort()
}

const idpUnknown = (name: string) => ({
  error: 'IDP_NOT_FOUND',
  message: `IdP "${name}" not found.`,
  hint: 'Run: astrale idp list',
})

const invalidName = (kind: string, name: string) => ({
  error: 'INVALID_NAME',
  message: `Invalid ${kind} name "${name}" — must be non-empty and contain only letters, digits, hyphens, underscores, and dots`,
})

/** @evidence TEST-CLI-PROGRAM-REFUSALS-TYPED */
test.each([
  { refusal: 'show of an unknown IdP', argv: ['idp', 'show', 'nope'], failure: idpUnknown('nope') },
  {
    refusal: 'show of an Object.prototype member name',
    argv: ['idp', 'show', 'toString'],
    failure: idpUnknown('toString'),
  },
  {
    refusal: 'removal of an unknown IdP',
    argv: ['idp', 'remove', 'nope'],
    failure: idpUnknown('nope'),
  },
  {
    refusal: 'refresh of an unknown IdP',
    argv: ['idp', 'refresh', 'nope'],
    failure: idpUnknown('nope'),
  },
  {
    refusal: 'removal of the built-in IdP',
    argv: ['idp', 'remove', 'workos'],
    failure: { error: 'IDP_BUILT_IN', message: 'Cannot remove built-in IdP "workos".' },
  },
  {
    refusal: 'an invalid identity name',
    argv: ['identity', 'create', 'bad name'],
    failure: invalidName('identity', 'bad name'),
  },
  {
    refusal: 'an invalid IdP name',
    argv: ['idp', 'add', 'a b', '--issuer', '{observer}'],
    failure: invalidName('idp', 'a b'),
  },
  {
    refusal: 'an invalid bookmark URL',
    argv: ['instance', 'bookmark', 'staging', '--url', 'notaurl'],
    failure: {
      error: 'INVALID_URL',
      message: 'Invalid URL "notaurl" — expected a valid http:// or https:// URL',
    },
  },
  {
    refusal: 'a bookmark without its required --url',
    argv: ['instance', 'bookmark', 'staging'],
    failure: {
      error: 'USAGE_ERROR',
      message: "error: required option '--url <url>' not specified",
      detail:
        "error: required option '--url <url>' not specified\n\nUsage:\n  astrale instance bookmark <name>",
    },
  },
])(
  'refuses $refusal with its typed error, exit 1, no connection, and an unchanged home',
  async ({ argv, failure }) => {
    const observer = await observeConnections()
    try {
      const before = await tree(home)
      const result = await runCli(
        home,
        ['--ci', ...argv.map((arg) => (arg === '{observer}' ? observer.url : arg))],
        { env: { ASTRALE_TELEMETRY: '0' } },
      )

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(JSON.parse(result.stderr)).toEqual(failure)
      expect(observer.count()).toBe(0)
      expect(await tree(home)).toEqual(before)
    } finally {
      await observer.close()
    }
  },
  cliRuns(1),
)

/** @evidence TEST-CLI-PROGRAM-UNTYPED-FAILURE-OPAQUE */
test(
  'reports an untyped failure once as UNEXPECTED_ERROR, exit 1, with no source or stack',
  async () => {
    // A home that is a regular file fails the keypair write with a raw filesystem error.
    const result = await runCli(fileHome, ['--ci', 'identity', 'create', 'bob'], {
      env: { ASTRALE_TELEMETRY: '0' },
    })

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toEqual({
      error: 'UNEXPECTED_ERROR',
      message: 'The CLI encountered an unexpected internal failure.',
    })
    expect(await readFile(fileHome, 'utf8')).toBe('not a directory\n')
  },
  cliRuns(1),
)
