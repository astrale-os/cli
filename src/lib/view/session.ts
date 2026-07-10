import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { paths } from '../env'

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
  view: {
    url: string
    functionId: string
    handshake: 'shell' | 'none'
    /** ViewPath or resolved view node path, when the view came from the graph. */
    path?: string
    name?: string
  }
  target?: { id?: string; path?: string }
  instance?: string
  identity?: string
  createdAt: string
}

/** Everything the detached `view __serve` process needs, written before spawn. */
export type ViewServeConfig = {
  session: ViewSessionRecord
  /** Kernel passthrough opts, re-resolved server-side for token mints. */
  kernel: { url?: string; instance?: string; as?: string; creds?: string; timeout?: string }
  /**
   * Kernel the view dispatches to. `direct: true` hands the child the kernel
   * URL itself (public https kernels — the router serves CORS, and Chrome's
   * local-network-access rules forbid a public view origin fetching our
   * loopback proxy). Otherwise the child gets the nonce-scoped proxy, which
   * handles CORS and self-signed local CAs.
   */
  proxy: { kernelUrl: string; caFile?: string; direct: boolean }
  idleMs: number
}

export const recordPath = (id: string): string => join(VIEW_DIR, `${id}.json`)
export const logPath = (id: string): string => join(VIEW_DIR, `${id}.log`)
export const configPath = (id: string): string => join(VIEW_DIR, `${id}.config.json`)

export async function saveRecord(record: ViewSessionRecord): Promise<void> {
  await mkdir(VIEW_DIR, { recursive: true })
  await writeFile(recordPath(record.id), `${JSON.stringify(record, null, 2)}\n`)
}

export async function removeSessionFiles(id: string): Promise<void> {
  await Promise.all([
    rm(recordPath(id), { force: true }),
    rm(configPath(id), { force: true }),
    rm(logPath(id), { force: true }),
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
