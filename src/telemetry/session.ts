/**
 * Session identity: buckets CLI invocations by workspace (git root, else cwd).
 * ASTRALE_SESSION pins an explicit id owned by a surface; otherwise an ambient
 * session is reused within the idle window or minted per root. Never spawns a
 * child process; every fs touch is swallowed so telemetry can't break the CLI.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { SessionMeta } from './types'

import { metaPath, readMeta, scanSessions, sessionDir, type SessionScan } from './store'

export type ResolvedSession = { id: string; root: string; explicit: boolean }

const MAX_ID_LEN = 64

/** Nearest ancestor of `start` (inclusive) containing a `.git` entry, else null. */
function findGitRoot(start: string): string | null {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Keep only id-safe chars, capped to 64. */
function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, MAX_ID_LEN)
}

/** Local-time yyyymmddHHmm stamp for a minted ambient id. */
function stamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getFullYear(), 4)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`
}

/** id of an open, ambient session already bucketed to `root`, else null.
 *  Analyzed sessions are never reused — a straggler event may "reopen" one
 *  after its report, and new work funneled there would never be analyzed.
 *  Only the open, unanalyzed candidates get their meta.json read: on a store of
 *  hundreds at most a couple qualify, and this runs before every command. */
function findOpenAmbient(root: string, sessions: readonly SessionScan[]): string | null {
  for (const s of sessions) {
    if (s.closed || s.analyzed) continue
    const meta = readMeta(s.id)
    if (meta?.root === root && meta.explicit === false) return s.id
  }
  return null
}

function mintAmbientId(root: string): string {
  const hash8 = createHash('sha256').update(root).digest('hex').slice(0, 8)
  return `amb-${hash8}-${stamp()}`
}

/** Resolve the session identity for `cwd` without creating anything on disk.
 *  `sessions` lets the caller hand over a scan it already paid for — the CLI
 *  start path shares one between recording and retention. */
export function resolveSession(cwd: string, sessions?: readonly SessionScan[]): ResolvedSession {
  const root = findGitRoot(cwd) ?? cwd
  const pinned = process.env.ASTRALE_SESSION
  if (pinned) {
    const id = sanitizeId(pinned)
    if (id.length > 0) return { id, root, explicit: true }
  }
  // Only scan when a pinned id did not already settle it.
  const scan = sessions ?? scanSessions()
  return { id: findOpenAmbient(root, scan) ?? mintAmbientId(root), root, explicit: false }
}

/** Resolve, then create the session dir + meta.json on first sight. */
export function ensureSession(cwd: string, sessions?: readonly SessionScan[]): ResolvedSession {
  const resolved = resolveSession(cwd, sessions)
  const dir = sessionDir(resolved.id)
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true })
      const meta: SessionMeta = {
        id: resolved.id,
        root: resolved.root,
        explicit: resolved.explicit,
        createdAt: new Date().toISOString(),
      }
      writeFileSync(metaPath(resolved.id), JSON.stringify(meta, null, 2) + '\n')
    } catch {
      /* telemetry never breaks the CLI */
    }
  }
  return resolved
}
