import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Write-tmp-then-rename so readers never observe a partial file. Mode 0600. */
export async function atomicWrite(path: string, data: string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeFile(tmp, data, { mode: 0o600 })
  await rename(tmp, path)
}

export type FileLockOptions = {
  /** Delay between acquisition attempts while another process holds the lock. */
  pollIntervalMs?: number
  /** A lock file whose mtime is older than this is considered abandoned. */
  staleAfterMs?: number
  /** Give up acquiring after this long. */
  timeoutMs?: number
}

/**
 * Run `fn` under a cross-process mutex backed by a create-exclusive lock file.
 *
 * Contenders poll until the holder releases (unlinks) the lock. Abandoned
 * locks are taken over when the holder pid is dead or the file's mtime
 * exceeds `staleAfterMs` — a crash mid-section can therefore delay other
 * processes by up to `staleAfterMs`, never deadlock them.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts: FileLockOptions = {},
): Promise<T> {
  const pollIntervalMs = opts.pollIntervalMs ?? 100
  const staleAfterMs = opts.staleAfterMs ?? 30_000
  const timeoutMs = opts.timeoutMs ?? 60_000
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const acquired = await tryAcquire(lockPath)
    if (acquired) {
      try {
        return await fn()
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

async function tryAcquire(lockPath: string): Promise<boolean> {
  try {
    const handle = await open(lockPath, 'wx', 0o600)
    try {
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      )
    } finally {
      await handle.close()
    }
    return true
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'EEXIST') return false
    if (code === 'ENOENT') {
      await mkdir(dirname(lockPath), { recursive: true })
      return tryAcquire(lockPath)
    }
    throw e
  }
}

/**
 * Remove the lock if its holder is gone (dead pid, fast) or it outlived
 * `staleAfterMs` (mtime, covers unreadable pids and cross-container holders).
 * Returns true when the caller should immediately retry acquisition —
 * `open('wx')` re-arbitrates between concurrent takeover candidates.
 */
async function takeoverIfAbandoned(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    const info = await stat(lockPath)
    if (Date.now() - info.mtimeMs > staleAfterMs) {
      await unlink(lockPath).catch(() => undefined)
      return true
    }
  } catch (e) {
    // Lock vanished between attempts: holder released — retry right away.
    if ((e as { code?: string }).code === 'ENOENT') return true
    throw e
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
    const raw = await readFile(lockPath, 'utf-8')
    const pid = (JSON.parse(raw) as { pid?: unknown }).pid
    return typeof pid === 'number' ? pid : undefined
  } catch {
    return undefined
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM means the pid exists but belongs to another user — still alive.
    return (e as { code?: string }).code === 'EPERM'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
