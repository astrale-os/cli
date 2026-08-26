import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { atomicWrite, atomicWriteSync, withFileLock } from '../files'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'astrale-state-files-'))
})

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('atomicWrite', () => {
  /** @evidence TEST-CLI-STATE-ATOMIC-WRITE */
  test('publishes a synced mode-0600 file without temporary residue', async () => {
    const path = join(temporaryDirectory, 'nested', 'state.json')

    await atomicWrite(path, '{"value":1}')

    expect(await readFile(path, 'utf-8')).toBe('{"value":1}')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readdir(join(temporaryDirectory, 'nested'))).toEqual(['state.json'])
  })

  /** @evidence TEST-CLI-STATE-ATOMIC-WRITE-FAILURE */
  test('does not disturb the target or retain a temporary file after failure', async () => {
    const path = join(temporaryDirectory, 'target')
    await mkdir(path)
    await writeFile(join(path, 'retained'), 'stable')

    await expect(atomicWrite(path, 'replacement')).rejects.toThrow()

    expect(await readFile(join(path, 'retained'), 'utf-8')).toBe('stable')
    expect((await readdir(temporaryDirectory)).sort()).toEqual(['target'])
  })
})

describe('atomicWriteSync', () => {
  test('publishes a synced mode-0600 file without temporary residue', async () => {
    const path = join(temporaryDirectory, 'sync', 'state.json')

    atomicWriteSync(path, '{"value":1}')

    expect(await readFile(path, 'utf-8')).toBe('{"value":1}')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readdir(join(temporaryDirectory, 'sync'))).toEqual(['state.json'])
  })

  test('does not disturb the target or retain a temporary file after failure', async () => {
    const path = join(temporaryDirectory, 'sync-target')
    await mkdir(path)
    await writeFile(join(path, 'retained'), 'stable')

    expect(() => atomicWriteSync(path, 'replacement')).toThrow()

    expect(await readFile(join(path, 'retained'), 'utf-8')).toBe('stable')
    expect((await readdir(temporaryDirectory)).sort()).toEqual(['sync-target'])
  })
})

describe('withFileLock', () => {
  /** @evidence TEST-CLI-STATE-LOCK-SERIALIZES */
  test('serializes contending read-modify-write transitions', async () => {
    const lockPath = join(temporaryDirectory, 'counter.lock')
    const counterPath = join(temporaryDirectory, 'counter')
    await writeFile(counterPath, '0')

    const bump = () =>
      withFileLock(
        lockPath,
        async () => {
          const value = Number(await readFile(counterPath, 'utf-8'))
          await new Promise((resolve) => setTimeout(resolve, 2))
          await writeFile(counterPath, String(value + 1))
        },
        { pollIntervalMs: 2 },
      )
    await Promise.all(Array.from({ length: 20 }, bump))

    expect(await readFile(counterPath, 'utf-8')).toBe('20')
  })

  /** @evidence TEST-CLI-STATE-LOCK-RECOVERS */
  test('recovers stale and dead-owner locks', async () => {
    const stalePath = join(temporaryDirectory, 'stale.lock')
    await writeFile(stalePath, JSON.stringify({ pid: process.pid }))
    const past = new Date(Date.now() - 60_000)
    await utimes(stalePath, past, past)
    await expect(withFileLock(stalePath, async () => 'stale', { pollIntervalMs: 2 })).resolves.toBe(
      'stale',
    )

    const deadPath = join(temporaryDirectory, 'dead.lock')
    await writeFile(deadPath, JSON.stringify({ pid: 99_999_999 }))
    await expect(withFileLock(deadPath, async () => 'dead', { pollIntervalMs: 2 })).resolves.toBe(
      'dead',
    )
  })

  /** @evidence TEST-CLI-STATE-LOCK-RELEASES-AND-BOUNDS */
  test('releases after failure and bounds acquisition behind a live owner', async () => {
    const releasedPath = join(temporaryDirectory, 'released.lock')
    await expect(
      withFileLock(releasedPath, async () => {
        throw new Error('transition failed')
      }),
    ).rejects.toThrow('transition failed')
    await expect(access(releasedPath)).rejects.toThrow()
    await expect(withFileLock(releasedPath, async () => 'next')).resolves.toBe('next')

    const heldPath = join(temporaryDirectory, 'held.lock')
    await writeFile(heldPath, JSON.stringify({ pid: process.pid }))
    await expect(
      withFileLock(heldPath, async () => 'unreachable', {
        pollIntervalMs: 10,
        staleAfterMs: 60_000,
        timeoutMs: 40,
      }),
    ).rejects.toThrow('Timed out')
  })
})
