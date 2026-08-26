import type { SessionRouteArtifact } from '@astrale-os/sdk/client/session'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FileSessionRouteStore } from '../session-routes'

let directory: string
let path: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'astrale-session-routes-'))
  path = join(directory, 'private', 'routes.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('session route file store', () => {
  test('round-trips the Kernel-owned artifact under owner-private filesystem modes', async () => {
    const artifact: SessionRouteArtifact = { version: 1, entries: {} }
    const store = new FileSessionRouteStore(path)

    store.write(artifact)

    expect(store.read()).toEqual(artifact)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(directory, 'private'))).mode & 0o777).toBe(0o700)
    expect(await readFile(path, 'utf8')).toBe('{"version":1,"entries":{}}\n')

    store.clear()
    await expect(access(path)).rejects.toThrow()
    expect(() => store.clear()).not.toThrow()
  })

  test('leaves malformed representation recovery to Kernel Client as a cold miss', async () => {
    await mkdir(join(directory, 'private'))
    await writeFile(path, '{invalid')
    const fixture = join(import.meta.dir, 'fixtures', 'session-route-process.ts')

    expect(await runFixture(fixture, path)).toEqual({
      value: 'done',
      sourceAttempts: 1,
      destinationAttempts: 1,
    })
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 1 })
  })

  test('reuses Kernel-admitted routing state in a separate operating-system process', async () => {
    const routePath = join(directory, 'private', 'routes.json')
    const fixture = join(import.meta.dir, 'fixtures', 'session-route-process.ts')

    const first = await runFixture(fixture, routePath)
    const second = await runFixture(fixture, routePath)

    expect(first).toEqual({ value: 'done', sourceAttempts: 1, destinationAttempts: 1 })
    expect(second).toEqual({ value: 'done', sourceAttempts: 0, destinationAttempts: 1 })
  })

  test('publishes only complete owner-private artifacts under concurrent process writers', async () => {
    const routePath = join(directory, 'private', 'routes.json')
    const fixture = join(import.meta.dir, 'fixtures', 'session-route-process.ts')

    const results = await Promise.all(
      Array.from({ length: 8 }, () => runFixture(fixture, routePath)),
    )
    expect(results).toHaveLength(8)
    expect(results.every((result) => result.destinationAttempts === 1)).toBe(true)
    expect(JSON.parse(await readFile(routePath, 'utf8'))).toMatchObject({ version: 1 })
    expect((await stat(routePath)).mode & 0o777).toBe(0o600)
    expect(await runFixture(fixture, routePath)).toEqual({
      value: 'done',
      sourceAttempts: 0,
      destinationAttempts: 1,
    })
  })

  test('auth logout clears every persisted bearer cache through the real CLI command', async () => {
    const routePath = join(directory, 'session', 'routes.json')
    const exchangePath = join(directory, 'exchange', 'credentials.json')
    await mkdir(join(directory, 'session'), { recursive: true })
    await mkdir(join(directory, 'exchange'), { recursive: true })
    await writeFile(routePath, '{"version":1,"entries":{"confidential":{}}}\n')
    await writeFile(
      exchangePath,
      '{"version":2,"entries":{"confidential":{"credential":"bearer"}}}\n',
    )

    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, '../../..', 'bin', 'astrale.ts'),
        'auth',
        'logout',
        '--all',
        '--json',
      ],
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
    expect(JSON.parse(stdout)).toEqual({ cleared: [] })
    await expect(access(routePath)).rejects.toThrow()
    expect(JSON.parse(await readFile(exchangePath, 'utf8'))).toEqual({ version: 2, entries: {} })
  })
})

interface FixtureResult {
  readonly value: string
  readonly sourceAttempts: number
  readonly destinationAttempts: number
}

async function runFixture(fixture: string, routePath: string): Promise<FixtureResult> {
  const child = Bun.spawn([process.execPath, fixture, routePath], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(exitCode, stderr).toBe(0)
  return JSON.parse(stdout) as FixtureResult
}
