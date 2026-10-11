/**
 * `astrale studio` stops waiting the moment this server exits, so with nothing to open
 * the server must exit, non-zero, instead of idling on a port it never bound.
 */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workspaces: string[] = []

afterEach(() => {
  while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true })
})

test('the server refuses a workspace with no domain and exits non-zero', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'studio-empty-workspace-'))
  workspaces.push(workspace)
  // A port the server must never reach: it has to give up before binding.
  const port = 45_999

  const server = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, 'index.ts'),
      workspace,
      '--port',
      `${port}`,
      '--no-open',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const timer = setTimeout(() => server.kill(), 30_000)
  const [exitCode, stderr] = await Promise.all([
    server.exited,
    new Response(server.stderr).text(),
  ]).finally(() => clearTimeout(timer))

  expect(exitCode).toBe(1)
  expect(stderr).toContain('No Astrale domains found')
  expect(stderr).toContain(workspace)
  await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow()
})
