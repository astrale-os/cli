import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { replaceStandaloneBinary } from '../standalone-binary'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'astrale-binary-test-'))
  roots.push(root)
  const bin = join(root, 'bin')
  await mkdir(bin)
  const installedBinary = join(bin, 'astrale')
  const nextBinary = join(root, 'next')
  await writeFile(installedBinary, 'old binary', { mode: 0o755 })
  await writeFile(nextBinary, 'new binary')
  return { installedBinary, nextBinary, lock: join(bin, '.astrale-install.lock') }
}

describe('standalone binary replacement', () => {
  test('retains rollback and the writer lock until metadata commits', async () => {
    const input = await fixture()
    const replacement = await replaceStandaloneBinary(input)
    expect(await readFile(input.installedBinary, 'utf8')).toBe('new binary')
    expect(await readFile(input.installedBinary + '.previous', 'utf8')).toBe('old binary')
    expect((await stat(input.installedBinary)).mode & 0o777).toBe(0o755)
    await expect(replaceStandaloneBinary(input)).rejects.toThrow()
    await replacement.finalize()
    await replacement.finalize()
    await expect(stat(input.lock)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(input.installedBinary + '.previous')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test('restores the executable atomically when metadata cannot commit', async () => {
    const input = await fixture()
    const replacement = await replaceStandaloneBinary(input)
    await replacement.rollback()
    await replacement.rollback()
    expect(await readFile(input.installedBinary, 'utf8')).toBe('old binary')
    await expect(stat(input.lock)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('a failed replacement leaves the executable unchanged and releases the lock', async () => {
    const input = await fixture()
    await expect(
      replaceStandaloneBinary(input, {
        rename: async () => {
          throw new Error('commit refused')
        },
      }),
    ).rejects.toThrow('commit refused')
    expect(await readFile(input.installedBinary, 'utf8')).toBe('old binary')
    await expect(stat(input.lock)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(input.installedBinary + '.next')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('retains recovery bytes and reports a failed rollback', async () => {
    const input = await fixture()
    const replacement = await replaceStandaloneBinary(input, {
      rename: async (from, to) => {
        if (String(from).endsWith('.previous')) throw new Error('restore refused')
        await rename(from, to)
      },
    })
    await expect(replacement.rollback()).rejects.toThrow('Standalone update rollback failed')
    expect(await readFile(input.installedBinary + '.previous', 'utf8')).toBe('old binary')
    await expect(stat(input.lock)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
