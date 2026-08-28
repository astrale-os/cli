import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { AstraleError } from '../errors'

type LockFilesystem = Readonly<{
  mkdir: typeof mkdir
  readFile: typeof readFile
  rename: typeof rename
  rm: typeof rm
  writeFile: typeof writeFile
}>

const defaultFilesystem: LockFilesystem = { mkdir, readFile, rename, rm, writeFile }

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !isCode(error, 'ESRCH')
  }
}

function parseOwner(raw: string): { pid: number; token: string } | undefined {
  const match = /^(\d+) ([A-Za-z0-9-]+)\n?$/u.exec(raw)
  if (!match) return undefined
  const pid = Number(match[1])
  return Number.isSafeInteger(pid) && pid > 0 ? { pid, token: match[2] } : undefined
}

export type InstallLock = Readonly<{
  path: string
  release(): Promise<void>
}>

export async function acquireInstallLock(
  installedBinary: string,
  dependencies: Partial<LockFilesystem> &
    Readonly<{
      pid?: number
      token?: string
      processAlive?: (pid: number) => boolean
    }> = {},
): Promise<InstallLock> {
  const filesystem = { ...defaultFilesystem, ...dependencies }
  const pid = dependencies.pid ?? process.pid
  const token = dependencies.token ?? randomUUID()
  const alive = dependencies.processAlive ?? processAlive
  const path = join(dirname(installedBinary), '.astrale-install.lock')
  const ownerPath = join(path, 'owner')

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await filesystem.mkdir(path)
      try {
        await filesystem.writeFile(ownerPath, `${pid} ${token}\n`, { mode: 0o600 })
      } catch (error) {
        await filesystem.rm(path, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }

      let released = false
      return Object.freeze({
        path,
        release: async () => {
          if (released) return
          const owner = parseOwner(await filesystem.readFile(ownerPath, 'utf8').catch(() => ''))
          if (owner?.pid !== pid || owner.token !== token) {
            throw new AstraleError(
              'UPDATE_INSTALL_LOCK_LOST',
              `Astrale install lock ownership changed at ${path}; refusing to remove it.`,
            )
          }
          released = true
          await filesystem.rm(path, { recursive: true, force: true })
        },
      })
    } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error
    }

    const owner = parseOwner(await filesystem.readFile(ownerPath, 'utf8').catch(() => ''))
    if (!owner) {
      throw new AstraleError(
        'UPDATE_INSTALL_LOCK_INVALID',
        `Invalid Astrale install lock at ${path}; refusing to replace an unknown owner.`,
      )
    }
    if (alive(owner.pid)) {
      throw new AstraleError(
        'UPDATE_INSTALL_BUSY',
        `Another Astrale install or update is running (pid ${owner.pid}).`,
      )
    }

    const stale = `${path}.stale-${pid}-${token}`
    try {
      await filesystem.rename(path, stale)
    } catch (error) {
      if (isCode(error, 'ENOENT')) continue
      throw error
    }
    await filesystem.rm(stale, { recursive: true, force: true })
  }

  throw new AstraleError(
    'UPDATE_INSTALL_BUSY',
    `Astrale install lock at ${path} changed repeatedly; retry the command.`,
  )
}
