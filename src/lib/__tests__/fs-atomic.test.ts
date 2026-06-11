import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { atomicWrite, withFileLock } from '../fs-atomic'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'astrale-fs-atomic-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('atomicWrite', () => {
  test('writes the content with mode 0600 and leaves no tmp files behind', async () => {
    const path = join(tmp, 'out.json')

    await atomicWrite(path, '{"a":1}')

    expect(await readFile(path, 'utf-8')).toBe('{"a":1}')
    expect(((await stat(path)).mode & 0o777).toString(8)).toBe('600')
    expect(await readdir(tmp)).toEqual(['out.json'])
  })
})

describe('withFileLock', () => {
  test('serializes concurrent read-modify-write cycles', async () => {
    const lockPath = join(tmp, 'counter.lock')
    const counterPath = join(tmp, 'counter')
    await writeFile(counterPath, '0')

    const bump = () =>
      withFileLock(
        lockPath,
        async () => {
          const value = Number(await readFile(counterPath, 'utf-8'))
          await new Promise((r) => setTimeout(r, 2))
          await writeFile(counterPath, String(value + 1))
        },
        { pollIntervalMs: 2 },
      )
    await Promise.all(Array.from({ length: 20 }, bump))

    expect(await readFile(counterPath, 'utf-8')).toBe('20')
  })

  test('takes over a lock whose mtime is stale', async () => {
    const lockPath = join(tmp, 'stale.lock')
    await writeFile(lockPath, JSON.stringify({ pid: process.pid }))
    const past = new Date(Date.now() - 60_000)
    await utimes(lockPath, past, past)

    const ran = await withFileLock(lockPath, async () => 'ran', { pollIntervalMs: 5 })

    expect(ran).toBe('ran')
  })

  test('takes over a fresh lock held by a dead pid', async () => {
    const lockPath = join(tmp, 'dead.lock')
    await writeFile(lockPath, JSON.stringify({ pid: 99999999 }))

    const ran = await withFileLock(lockPath, async () => 'ran', { pollIntervalMs: 5 })

    expect(ran).toBe('ran')
  })

  test('releases the lock when fn throws', async () => {
    const lockPath = join(tmp, 'throw.lock')

    await expect(
      withFileLock(lockPath, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    const ran = await withFileLock(lockPath, async () => 'ran', { timeoutMs: 200 })
    expect(ran).toBe('ran')
  })

  test('creates a missing parent directory', async () => {
    const lockPath = join(tmp, 'nested', 'deep', 'a.lock')

    const ran = await withFileLock(lockPath, async () => 'ran')

    expect(ran).toBe('ran')
  })

  test('times out while a live holder keeps the lock', async () => {
    const lockPath = join(tmp, 'held.lock')
    await writeFile(lockPath, JSON.stringify({ pid: process.pid }))

    await expect(
      withFileLock(lockPath, async () => 'ran', {
        pollIntervalMs: 20,
        staleAfterMs: 60_000,
        timeoutMs: 150,
      }),
    ).rejects.toThrow('Timed out')
  })
})
