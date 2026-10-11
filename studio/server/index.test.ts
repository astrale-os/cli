/**
 * The other half of the "hand the terminal back" contract.
 *
 * `astrale studio` stops waiting the moment this server exits, so the server
 * must actually exit — and non-zero — when the workspace holds nothing to open,
 * rather than idling on a port it never bound. A server that lingered here would
 * put the CLI back to polling until its indexing budget ran out.
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
      String(port),
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
