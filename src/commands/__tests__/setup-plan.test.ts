import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCli } from './fixtures/process'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'astrale-setup-plan-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

type Plan = { connected: boolean; steps: { id: string; state: string; fix?: string }[] }

// `astrale setup --plan --json` is the agent-facing contract: a read-only gap report where every
// unsatisfied step carries the command to fix it.
test('setup --plan reports a fresh home as not connected, with a fix per connect gap', async () => {
  const result = await runCli(tmp, ['setup', '--plan', '--json', 'my-app'])
  expect(result.exitCode).toBe(0)
  const plan = JSON.parse(result.stdout) as Plan
  expect(plan.connected).toBe(false)
  const byId = Object.fromEntries(plan.steps.map((step) => [step.id, step]))
  expect(byId.auth).toMatchObject({ state: 'gap', fix: 'astrale auth login' })
  // The admin control plane always has a baked default.
  expect(byId.admin?.state).toBe('satisfied')
  // The positional slug threads into the instance fix.
  expect(byId.instance).toMatchObject({ state: 'gap', fix: 'astrale instance create my-app' })
})
