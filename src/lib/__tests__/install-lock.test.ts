import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquireInstallLock } from '../install-lock'

describe('install lock', () => {
  test('excludes a live owner and releases only its own evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-install-lock-'))
    const binary = join(root, 'astrale')
    const first = await acquireInstallLock(binary, { pid: process.pid, token: 'first-owner' })

    await expect(acquireInstallLock(binary)).rejects.toMatchObject({ code: 'UPDATE_INSTALL_BUSY' })
    expect(await readFile(join(first.path, 'owner'), 'utf8')).toBe(`${process.pid} first-owner\n`)
    await first.release()
    await expect(readFile(join(first.path, 'owner'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await rm(root, { recursive: true, force: true })
  })

  test('recovers a definitely dead owner and fails closed on malformed evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-install-lock-'))
    const binary = join(root, 'astrale')
    const path = join(root, '.astrale-install.lock')
    await mkdir(path)
    await writeFile(join(path, 'owner'), '99999999 stale-owner\n')

    const recovered = await acquireInstallLock(binary, {
      pid: process.pid,
      token: 'replacement-owner',
      processAlive: () => false,
    })
    expect(await readFile(join(path, 'owner'), 'utf8')).toBe(`${process.pid} replacement-owner\n`)
    await recovered.release()

    await mkdir(path)
    await writeFile(join(path, 'owner'), 'malformed\n')
    await expect(acquireInstallLock(binary)).rejects.toMatchObject({
      code: 'UPDATE_INSTALL_LOCK_INVALID',
    })
    expect(await readFile(join(path, 'owner'), 'utf8')).toBe('malformed\n')
    await rm(root, { recursive: true, force: true })
  })

  test('a stale handle never removes replacement ownership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-install-lock-'))
    const binary = join(root, 'astrale')
    const lock = await acquireInstallLock(binary, { token: 'original-owner' })
    await writeFile(join(lock.path, 'owner'), `${process.pid} replacement-owner\n`)

    await expect(lock.release()).rejects.toMatchObject({ code: 'UPDATE_INSTALL_LOCK_LOST' })
    expect(await readFile(join(lock.path, 'owner'), 'utf8')).toContain('replacement-owner')
    await rm(root, { recursive: true, force: true })
  })
})
