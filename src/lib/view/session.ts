import type { ResolvedView, ViewTransport } from '@astrale-os/shell'

import { closeSync, fchmodSync, openSync } from 'node:fs'
import { chmod, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { atomicWrite, paths } from '../../state/index'

/**
 * View-session records: one detached server process per open view, tracked as
 * `~/.astrale/view/<id>.json` (+ `<id>.log`, `<id>.config.json`). Records are
 * garbage-collected on every `astrale view` invocation by probing the pid.
 */

export const VIEW_DIR = join(paths.home, 'view')

export type ViewSessionRecord = {
  id: string
  pid: number
  port: number
  nonce: string
  /** Host page URL, nonce-scoped: `http://127.0.0.1:<port>/s/<nonce>/`. */
  pageUrl: string
  /** Exact verified View placement passed to Shell without split aliases. */
  view: ResolvedView
  instance?: string
  identity?: string
  createdAt: string
}

/** Everything the detached `view __serve` process needs, written before spawn. */
export type ViewServeConfig = {
  session: ViewSessionRecord
  /** Owner-local alternate document for this exact verified View placement. */
  transport?: ViewTransport
  /** Kernel passthrough opts, re-resolved server-side for token mints. */
  kernel: { url?: string; instance?: string; as?: string; creds?: string; timeout?: string }
  /**
   * Kernel the view dispatches to. `direct: true` hands the child the kernel
   * URL itself (public https kernels — the router serves CORS, and Chrome's
   * local-network-access rules forbid a public view origin fetching our
   * loopback proxy). Otherwise the child gets the nonce-scoped proxy, which
   * handles CORS and self-signed local CAs.
   */
  proxy: { kernelUrl: string; issuer: string; caFile?: string; direct: boolean }
  /** Exact HTTPS origins the operator consented to open from this View session. */
  externalOrigins: readonly string[]
  idleMs: number
}

export const recordPath = (id: string, directory = VIEW_DIR): string =>
  join(directory, `${id}.json`)
export const logPath = (id: string, directory = VIEW_DIR): string => join(directory, `${id}.log`)
export const configPath = (id: string, directory = VIEW_DIR): string =>
  join(directory, `${id}.config.json`)

/** Create or repair the credential-bearing session directory as owner-only. */
export async function ensureViewDirectory(directory = VIEW_DIR): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
}

export async function saveRecord(record: ViewSessionRecord, directory = VIEW_DIR): Promise<void> {
  await ensureViewDirectory(directory)
  await atomicWrite(recordPath(record.id, directory), `${JSON.stringify(record, null, 2)}\n`)
}

/** Atomically publish the detached process config; it may contain raw `--creds`. */
export async function saveServeConfig(
  config: ViewServeConfig,
  directory = VIEW_DIR,
): Promise<void> {
  await ensureViewDirectory(directory)
  await atomicWrite(
    configPath(config.session.id, directory),
    `${JSON.stringify(config, null, 2)}\n`,
  )
}

/** Open or repair a session log as owner-only and return its descriptor. */
export async function openSessionLog(id: string, directory = VIEW_DIR): Promise<number> {
  await ensureViewDirectory(directory)
  const descriptor = openSync(logPath(id, directory), 'a', 0o600)
  try {
    fchmodSync(descriptor, 0o600)
    return descriptor
  } catch (error) {
    closeSync(descriptor)
    throw error
  }
}

export async function removeSessionFiles(id: string, directory = VIEW_DIR): Promise<void> {
  await Promise.all([
    rm(recordPath(id, directory), { force: true }),
    rm(configPath(id, directory), { force: true }),
    rm(logPath(id, directory), { force: true }),
  ])
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** List live sessions, removing records whose server process is gone. */
export async function listSessions(): Promise<ViewSessionRecord[]> {
  let entries: string[]
  try {
    entries = await readdir(VIEW_DIR)
  } catch {
    return []
  }
  const live: ViewSessionRecord[] = []
  for (const entry of entries) {
    if (!/^v-[0-9a-f]+\.json$/.test(entry)) continue
    let record: ViewSessionRecord
    try {
      record = JSON.parse(await readFile(join(VIEW_DIR, entry), 'utf8')) as ViewSessionRecord
    } catch {
      continue
    }
    if (isAlive(record.pid)) live.push(record)
    else await removeSessionFiles(record.id)
  }
  return live.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

const CLOSE_GRACE_MS = 2000

/** SIGTERM the session server (SIGKILL after a grace period), drop its files. */
export async function closeSession(record: ViewSessionRecord): Promise<void> {
  if (isAlive(record.pid)) {
    try {
      process.kill(record.pid, 'SIGTERM')
    } catch {
      // already gone
    }
    const deadline = Date.now() + CLOSE_GRACE_MS
    while (isAlive(record.pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (isAlive(record.pid)) {
      try {
        process.kill(record.pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
  }
  await removeSessionFiles(record.id)
}
