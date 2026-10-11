import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquireInstallLock } from '../install-lock'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function binary(): Promise<{ binary: string; lock: string }> {
  const root = await mkdtemp(join(tmpdir(), 'astrale-install-lock-'))
  roots.push(root)
  return { binary: join(root, 'astrale'), lock: join(root, '.astrale-install.lock') }
}

/** The lock format install.sh reads and writes: `<pid> <token>` in `<bin dir>/.astrale-install.lock/owner`. */
describe('install lock shared with install.sh', () => {
  test('excludes a live owner, recovers a dead one, and refuses an unreadable owner record', async () => {
    const paths = await binary()
    const held = await acquireInstallLock(paths.binary)
    expect(await readFile(join(paths.lock, 'owner'), 'utf8')).toMatch(
      new RegExp(`^${process.pid} [A-Za-z0-9-]+\\n$`),
    )
    await expect(acquireInstallLock(paths.binary)).rejects.toMatchObject({
      code: 'UPDATE_INSTALL_BUSY',
    })
    await held.release()

    await mkdir(paths.lock)
    await writeFile(join(paths.lock, 'owner'), '99999999 dead-owner\n')
    await (await acquireInstallLock(paths.binary)).release()

    await mkdir(paths.lock)
    await writeFile(join(paths.lock, 'owner'), 'malformed\n')
    await expect(acquireInstallLock(paths.binary)).rejects.toMatchObject({
      code: 'UPDATE_INSTALL_LOCK_INVALID',
    })
  })

  test('a holder whose ownership changed never removes the new owner', async () => {
    const paths = await binary()
    const held = await acquireInstallLock(paths.binary)
    await writeFile(join(paths.lock, 'owner'), `${process.pid} replacement-owner\n`)
    await expect(held.release()).rejects.toMatchObject({ code: 'UPDATE_INSTALL_LOCK_LOST' })
    expect(await readFile(join(paths.lock, 'owner'), 'utf8')).toContain('replacement-owner')
  })
})
