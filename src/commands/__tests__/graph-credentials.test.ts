import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('graph commands preserve Kernel-native identity and managed caller exchange', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astrale-graph-credentials-'))
  try {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, 'fixtures/graph-credentials.ts')],
      {
        env: { ...process.env, ASTRALE_HOME: directory },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ observations: 51, networkRequests: 0 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
