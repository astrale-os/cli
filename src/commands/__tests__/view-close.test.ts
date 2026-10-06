import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = fileURLToPath(new URL('../../../', import.meta.url))
const sessionModule = fileURLToPath(new URL('../../lib/view/session.ts', import.meta.url))
const commandModule = fileURLToPath(new URL('../view.ts', import.meta.url))
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('view close command process failures', () => {
  /** @evidence TEST-CLI-VIEW-CLOSE-REFUSAL-STRUCTURED-FAILURE */
  test('reports denied signals without claiming closure or deleting its catalog', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'astrale-view-close-'))
    temporaryDirectories.push(directory)
    const script = `
      import { closeSync } from 'node:fs'
      import { saveRecord, saveServeConfig, openSessionLog } from ${JSON.stringify(sessionModule)}
      const record = {
        id: 'v-a1b2c3', pid: 246801, port: 4419, nonce: 'nonce',
        pageUrl: 'http://127.0.0.1:4419/s/nonce/',
        view: { target: '/:example.test', route: {
          key: 'example.test:view.main', href: 'https://example.test/ui', handshake: 'shell',
          issuer: 'https://example.test', etag: 'sha256:' + 'a'.repeat(64),
          revision: 'sha256:' + 'b'.repeat(64), declaration: { target: { kind: 'domain' } },
        } }, createdAt: '2026-10-06T00:00:00.000Z',
      }
      await saveRecord(record)
      await saveServeConfig({ session: record, kernel: {}, proxy: { kernelUrl: 'https://kernel.test', issuer: 'https://kernel.test', direct: true }, externalOrigins: [], idleMs: 60_000 })
      closeSync(await openSessionLog(record.id))
      process.kill = () => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }) }
      const { default: command } = await import(${JSON.stringify(commandModule)})
      await command.action(undefined, { close: record.id, json: true })
    `
    const child = Bun.spawn([process.execPath, '-e', script], {
      cwd: cliRoot,
      env: { ...process.env, ASTRALE_HOME: directory, ASTRALE_TELEMETRY: '0' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])

    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(JSON.parse(stderr)).toMatchObject({
      error: 'VIEW_SESSION_CLOSE_FAILED',
      message: expect.stringContaining('SIGTERM failed: kill EPERM'),
      hint: expect.stringContaining('session is still listed'),
    })
    const recordPath = join(directory, 'view', 'v-a1b2c3.json')
    expect(JSON.parse(await readFile(recordPath, 'utf8')).id).toBe('v-a1b2c3')
    expect(await stat(join(directory, 'view', 'v-a1b2c3.config.json'))).toBeDefined()
    expect(await stat(join(directory, 'view', 'v-a1b2c3.log'))).toBeDefined()
  })
})
