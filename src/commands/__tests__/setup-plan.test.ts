import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cliRoot = join(import.meta.dir, '../../..')

// `astrale setup --plan --json` is the agent-facing contract: a read-only gap
// report where every unsatisfied step carries the command to fix it. These pin
// that shape on a FRESH home (nothing configured) so it stays machine-parseable.

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'astrale-setup-plan-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

type PlanStep = { id: string; group: string; state: string; summary: string; fix?: string }
type Plan = { connected: boolean; steps: PlanStep[] }

async function runSetupPlan(...args: string[]): Promise<{ exitCode: number; plan: Plan }> {
  const proc = Bun.spawn({
    cmd: ['bun', join(cliRoot, 'bin/astrale.ts'), 'setup', '--plan', '--json', ...args],
    env: { ...process.env, ASTRALE_HOME: tmp },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  return { exitCode, plan: JSON.parse(stdout) as Plan }
}

describe('astrale setup --plan', () => {
  test('reports a fresh home as not connected, with a fix per connect gap', async () => {
    const { exitCode, plan } = await runSetupPlan()
    expect(exitCode).toBe(0)
    expect(plan.connected).toBe(false)

    const byId = Object.fromEntries(plan.steps.map((s) => [s.id, s]))

    // Not signed in, with the granular command an agent would run.
    expect(byId.auth.state).toBe('gap')
    expect(byId.auth.fix).toBe('astrale auth login')

    // The admin control plane always has a baked default → satisfied.
    expect(byId.admin.state).toBe('satisfied')

    // No active instance yet.
    expect(byId.instance.state).toBe('gap')
    expect(byId.instance.fix).toContain('astrale instance create')
  })

  test('threads the positional slug into the instance fix hint', async () => {
    const { plan } = await runSetupPlan('my-app')
    const instance = plan.steps.find((s) => s.id === 'instance')
    expect(instance?.fix).toBe('astrale instance create my-app')
  })
})
