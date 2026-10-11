import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { chmod, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Atomically publish one complete private state file through a same-directory temporary file. */
export async function atomicWrite(path: string, data: string): Promise<void> {
  const directory = dirname(path)
  const temporary = `${path}.${randomUUID()}.tmp`
  await mkdir(directory, { recursive: true })

  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(data)
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)

    const directoryHandle = await open(directory, 'r')
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

/** Atomically publish one complete private state file for synchronous consumer capabilities. */
export function atomicWriteSync(path: string, data: string | Uint8Array): void {
  const directory = dirname(path)
  const temporary = `${path}.${randomUUID()}.tmp`
  mkdirSync(directory, { recursive: true })

  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, data)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporary, path)

    const directoryDescriptor = openSync(directory, 'r')
    try {
      fsyncSync(directoryDescriptor)
    } finally {
      closeSync(directoryDescriptor)
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    try {
      unlinkSync(temporary)
    } catch {
      // The temporary file was either never created or was already renamed.
    }
    throw error
  }
}

export interface FileLockOptions {
  readonly pollIntervalMs?: number
  readonly staleAfterMs?: number
  readonly timeoutMs?: number
}

/** Run one transition under a bounded cross-process create-exclusive lock. */
export async function withFileLock<Value>(
  lockPath: string,
  transition: () => Promise<Value>,
  options: FileLockOptions = {},
): Promise<Value> {
  const pollIntervalMs = options.pollIntervalMs ?? 100
  const staleAfterMs = options.staleAfterMs ?? 30_000
  const timeoutMs = options.timeoutMs ?? 60_000
  const deadline = Date.now() + timeoutMs

  for (;;) {
    if (await tryAcquire(lockPath)) {
      try {
        return await transition()
      } finally {
        await unlink(lockPath).catch(() => undefined)
      }
    }
    if (await takeoverIfAbandoned(lockPath, staleAfterMs)) continue
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for lock ${lockPath}`)
    }
    await sleep(pollIntervalMs)
  }
}

/**
 * Run one read-modify-write of an owner-private `{ version, entries }` store under its file lock.
 * A missing, unreadable or other-version store reads as empty; the store is rewritten only when
 * the transition reports a change.
 */
export async function updatePrivateStore<Entry, Value>(
  path: string,
  version: number,
  transition: (
    entries: Record<string, Entry>,
  ) => Promise<{ readonly value: Value; readonly changed: boolean }>,
  options?: FileLockOptions,
): Promise<Value> {
  return withFileLock(
    `${path}.lock`,
    async () => {
      const directory = dirname(path)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await chmod(directory, 0o700)
      const entries = await readPrivateStore<Entry>(path, version)
      const { value, changed } = await transition(entries)
      if (changed) {
        await atomicWrite(path, `${JSON.stringify({ version, entries }, null, 2)}\n`)
        await chmod(path, 0o600)
      }
      return value
    },
    options,
  )
}

/** The entries of an owner-private store; a missing, unreadable or other-version store is empty. */
export async function readPrivateStore<Entry>(
  path: string,
  version: number,
): Promise<Record<string, Entry>> {
  try {
    const store = JSON.parse(await readFile(path, 'utf8')) as {
      readonly version?: unknown
      readonly entries?: unknown
    } | null
    const entries = store?.version === version ? store.entries : undefined
    return entries !== null && typeof entries === 'object' && !Array.isArray(entries)
      ? { ...(entries as Record<string, Entry>) }
      : {}
  } catch {
    return {}
  }
}

async function tryAcquire(lockPath: string): Promise<boolean> {
  try {
    const handle = await open(lockPath, 'wx', 0o600)
    try {
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      )
      await handle.sync()
    } finally {
      await handle.close()
    }
    return true
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'EEXIST') return false
    if (code === 'ENOENT') {
      await mkdir(dirname(lockPath), { recursive: true })
      return tryAcquire(lockPath)
    }
    throw error
  }
}

async function takeoverIfAbandoned(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    const info = await stat(lockPath)
    if (Date.now() - info.mtimeMs > staleAfterMs) {
      await unlink(lockPath).catch(() => undefined)
      return true
    }
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return true
    throw error
  }

  const pid = await readLockPid(lockPath)
  if (pid !== undefined && pid !== process.pid && !isPidAlive(pid)) {
    await unlink(lockPath).catch(() => undefined)
    return true
  }
  return false
}

async function readLockPid(lockPath: string): Promise<number | undefined> {
  try {
    const value = (JSON.parse(await readFile(lockPath, 'utf-8')) as { pid?: unknown }).pid
    return typeof value === 'number' ? value : undefined
  } catch {
    return undefined
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM'
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
