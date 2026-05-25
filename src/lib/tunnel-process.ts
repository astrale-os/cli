import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { TUNNELS_DIR } from './paths'

/**
 * Neutral (adapter-agnostic) background-process bookkeeping for tunnels:
 * per-tunnel pid/log files under `TUNNELS_DIR` and process liveness/teardown.
 * No tunnel provider is referenced here — concrete adapters layer their own
 * spawn/auth logic on top of these helpers.
 */

export async function ensureTunnelsDir(): Promise<void> {
  await mkdir(TUNNELS_DIR, { recursive: true })
}

export function pidPath(id: string): string {
  return join(TUNNELS_DIR, `${id}.pid`)
}

export function logPath(id: string): string {
  return join(TUNNELS_DIR, `${id}.log`)
}

export async function writePidFile(id: string, pid: number): Promise<void> {
  await ensureTunnelsDir()
  await writeFile(pidPath(id), String(pid))
}

export async function readPidFile(id: string): Promise<number | null> {
  try {
    const raw = await readFile(pidPath(id), 'utf-8')
    const pid = Number.parseInt(raw.trim(), 10)
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

export async function removePidFile(id: string): Promise<void> {
  try {
    await unlink(pidPath(id))
  } catch {
    /* ignore */
  }
}

/** `process.kill(pid, 0)` liveness probe — true if the process still exists. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Best-effort SIGTERM to every tunnel pid recorded under `TUNNELS_DIR`.
 * Used by `astrale reset --hard`. Tolerates missing dir, missing pids, and
 * dead processes. Returns the number of pids signaled (live processes we
 * asked to exit).
 */
export async function stopAllTunnels(): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(TUNNELS_DIR)
  } catch {
    return 0
  }
  let signaled = 0
  for (const entry of entries) {
    if (!entry.endsWith('.pid')) continue
    let raw: string
    try {
      raw = await readFile(join(TUNNELS_DIR, entry), 'utf-8')
    } catch {
      continue
    }
    const pid = Number.parseInt(raw.trim(), 10)
    if (!Number.isFinite(pid) || pid <= 0) continue
    try {
      process.kill(pid, 'SIGTERM')
      signaled++
    } catch {
      /* already dead or not ours */
    }
  }
  return signaled
}
