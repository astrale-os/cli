import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { IdentityStore } from '../../identity/index'
import type { InstanceStore } from '../../lib/instance/bookmarks'

import { resolveUseTarget } from '../use'
import { cliRuns, runCli } from './fixtures/process'

const instances: InstanceStore = {
  active: 'staging',
  instances: {
    staging: { url: 'https://staging.example.com', slug: 'stage' },
    prod: { url: 'https://prod.example.com' },
  },
}

const identities: IdentityStore = {
  default: 'alice',
  identities: {
    alice: { subject: 'alice', createdAt: '2026-01-01T00:00:00.000Z', source: 'key' },
    prod: { subject: 'prod-user', createdAt: '2026-01-01T00:00:00.000Z', source: 'key' },
  },
}

test.each([
  ['alice', 'identity', 'alice'],
  ['staging', 'instance', 'staging'],
  ['stage', 'instance', 'staging'],
  ['prod', 'ambiguous', 'prod'],
  ['missing', 'missing', 'missing'],
  ['toString', 'missing', 'toString'],
] as const)('resolveUseTarget(%p) is %s %p', (input, kind, name) => {
  expect(resolveUseTarget(input, instances, identities)).toEqual({ kind, name })
})

test(
  '`use` refuses a name no identity or instance holds with NAME_NOT_FOUND',
  async () => {
    const home = await mkdtemp(join(tmpdir(), 'astrale-use-missing-'))
    try {
      const result = await runCli(home, ['--ci', 'use', 'missing'])
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stderr)).toEqual({
        error: 'NAME_NOT_FOUND',
        message: 'No identity or instance named "missing".',
        hint: 'Try: astrale identity list or astrale instance list',
      })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  },
  cliRuns(1),
)
