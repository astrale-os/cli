/**
 * What the probe says when the agent will not come up.
 *
 * The composer now puts this text on screen, under the field it disabled — so
 * "why can I not connect?" is answered there or nowhere.
 */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { probeAcpHealth } from './probe'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

/** An agent that dies on startup with something worth reading on stderr. */
function dyingAgent(complaint: string, code: number): string[] {
  const root = mkdtempSync(join(tmpdir(), 'acp-probe-'))
  roots.push(root)
  const file = join(root, 'agent.ts')
  writeFileSync(file, `process.stderr.write(${JSON.stringify(complaint)})\nprocess.exit(${code})\n`)
  return [process.execPath, file]
}

test('an agent that dies on startup is quoted, not paraphrased', async () => {
  const health = await probeAcpHealth({
    provider: 'claude',
    bin: 'claude',
    command: dyingAgent('claude: command not found — is it on your PATH?\n', 127),
  })

  expect(health.ok).toBe(false)
  // the SDK gets to the closed stream first and calls it "ACP connection closed",
  // which is the one thing nobody needs to be told; the exit and the agent's own
  // words are what a reader can act on
  expect(health.detail).toContain('exited 127')
  expect(health.detail).toContain('claude: command not found')
  expect(health.detail).not.toContain('connection closed')
})

test('a binary that is not there says so, rather than blaming the protocol', async () => {
  const health = await probeAcpHealth({
    provider: 'codex',
    bin: 'codex',
    command: [join(tmpdir(), 'no-such-acp-agent-binary')],
  })

  expect(health.ok).toBe(false)
  expect(health.detail).toContain('failed to spawn codex ACP agent')
})
