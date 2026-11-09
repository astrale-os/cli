import { afterAll, beforeAll, expect, test } from 'bun:test'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cliRuns, runCli } from '../../commands/__tests__/fixtures/process'

const CREATED_AT = '2026-11-09T00:00:00.000Z'
const REGISTRY = JSON.stringify({
  version: 1,
  default: 'alice',
  identities: {
    alice: { subject: 'alice', createdAt: CREATED_AT, source: 'key', mode: 'local' },
    'workos-user': {
      subject: 'user_123',
      createdAt: CREATED_AT,
      source: 'idp',
      mode: 'remote',
      idp: 'workos',
      issuer: 'https://idp.example',
    },
  },
})

let home = ''

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'astrale-identity-refusals-'))
  await writeFile(join(home, 'identities.json'), REGISTRY)
})

afterAll(async () => {
  await rm(home, { recursive: true, force: true })
})

const unknown = (name: string) => ({
  error: 'NO_IDENTITY',
  message: `Identity "${name}" not found.`,
  hint: `Run: astrale identity create ${name}`,
})

/** @evidence TEST-CLI-IDENTITY-REFUSALS-TYPED */
test.each([
  {
    refusal: 'delete of an unknown identity',
    argv: ['identity', 'delete', 'no-such-identity-xyz'],
    failure: unknown('no-such-identity-xyz'),
  },
  {
    refusal: 'delete of an Object.prototype member name',
    argv: ['identity', 'delete', 'toString'],
    failure: unknown('toString'),
  },
  {
    refusal: 'selection of an unknown identity',
    argv: ['identity', 'use', 'missing'],
    failure: unknown('missing'),
  },
  {
    refusal: 'selection of an unknown identity by `use --identity`',
    argv: ['use', 'missing', '--identity'],
    failure: unknown('missing'),
  },
  {
    refusal: 'export of an unknown identity',
    argv: ['identity', 'export', 'missing', 'export.json'],
    failure: unknown('missing'),
  },
  {
    refusal: 'sync of an unknown identity',
    argv: ['identity', 'sync', 'missing', '--force'],
    failure: unknown('missing'),
  },
  {
    refusal: 'unsync of an unknown identity',
    argv: ['identity', 'unsync', 'missing'],
    failure: unknown('missing'),
  },
  {
    refusal: 'creation under a held name',
    argv: ['identity', 'create', 'alice'],
    failure: {
      error: 'IDENTITY_EXISTS',
      message: 'Identity "alice" already exists.',
      hint: 'Pick a different identity name.',
    },
  },
  {
    refusal: 'deletion of the default identity',
    argv: ['identity', 'delete', 'alice'],
    failure: {
      error: 'IDENTITY_IS_DEFAULT',
      message: 'Cannot delete the default identity "alice".',
      hint: 'Switch default first with: astrale identity use <other>',
    },
  },
  {
    refusal: 'export of an IdP identity',
    argv: ['identity', 'export', 'workos-user', 'export.json'],
    failure: {
      error: 'INVALID_IDENTITY_SOURCE',
      message: 'Identity "workos-user" is IdP-backed and has no transferable local keypair.',
    },
  },
])(
  'refuses $refusal with its typed error, exit 1, and an unchanged registry',
  async ({ argv, failure }) => {
    const result = await runCli(
      home,
      ['--ci', ...argv.map((arg) => (arg === 'export.json' ? join(home, arg) : arg))],
      { env: { ASTRALE_TELEMETRY: '0' } },
    )

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toEqual(failure)
    expect(await readFile(join(home, 'identities.json'), 'utf8')).toBe(REGISTRY)
    await expect(access(join(home, 'export.json'))).rejects.toThrow()
  },
  cliRuns(1),
)
