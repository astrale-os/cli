/**
 * Session store layout under `~/.astrale/sessions/<id>/`:
 *   events.jsonl   append-only CLI events; its mtime IS the session's last-activity
 *   meta.json      SessionMeta, written once at creation
 *   .analyzed      AnalyzedMarker, written by the analyzer (any outcome)
 *   report.md      analyzer output
 * A session is CLOSED when events.jsonl's mtime is older than IDLE_WINDOW_MS.
 */
import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { AnalyzedMarker, SessionMeta } from './types'

import { createPaths } from '../state/index'

export const IDLE_WINDOW_MS = 30 * 60 * 1000

// Resolved at CALL time (not import time) so ASTRALE_HOME set late — notably
// by tests whose module-load order is out of their control — always applies.
// The env can't change mid-process in real CLI runs, so behavior is identical.
export function sessionsRoot(): string {
  return join(createPaths().home, 'sessions')
}

export function sessionDir(id: string): string {
  return join(sessionsRoot(), id)
}

export function eventsPath(id: string): string {
  return join(sessionDir(id), 'events.jsonl')
}

export function metaPath(id: string): string {
  return join(sessionDir(id), 'meta.json')
}

export function markerPath(id: string): string {
  return join(sessionDir(id), '.analyzed')
}

export function reportPath(id: string): string {
  return join(sessionDir(id), 'report.md')
}

/** Bytes on disk under `dir`. Unreadable entries count as zero — a directory
 *  racing away mid-walk is normal, not an error worth propagating. */
function directoryBytes(dir: string): number {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      total += directoryBytes(path)
    } else if (entry.isFile()) {
      try {
        total += statSync(path).size
      } catch {
        /* raced away mid-walk */
      }
    }
  }
  return total
}

/** Bytes one session occupies. The analyzer runs with Write inside the session
 *  directory and may nest, so this walks rather than listing one level. */
export function sessionBytes(id: string): number {
  return directoryBytes(sessionDir(id))
}

export type SessionInfo = {
  id: string
  meta: SessionMeta | null
  lastEventAt: Date | null
  closed: boolean
  analyzed: AnalyzedMarker | null
}

function readJsonSafe<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

export function inspectSession(id: string, now = Date.now()): SessionInfo | null {
  const dir = sessionDir(id)
  if (!existsSync(dir)) return null
  let lastEventAt: Date | null = null
  try {
    lastEventAt = statSync(eventsPath(id)).mtime
  } catch {
    /* no events yet */
  }
  return {
    id,
    meta: readJsonSafe<SessionMeta>(metaPath(id)),
    lastEventAt,
    closed: lastEventAt !== null && now - lastEventAt.getTime() > IDLE_WINDOW_MS,
    analyzed: readJsonSafe<AnalyzedMarker>(markerPath(id)),
  }
}

/** All sessions, newest activity first. Missing store dir → empty list. */
export function listSessions(now = Date.now()): SessionInfo[] {
  let ids: string[]
  try {
    ids = readdirSync(sessionsRoot()).filter((n) => !n.startsWith('.'))
  } catch {
    return []
  }
  return ids
    .map((id) => inspectSession(id, now))
    .filter((s): s is SessionInfo => s !== null)
    .sort((a, b) => (b.lastEventAt?.getTime() ?? 0) - (a.lastEventAt?.getTime() ?? 0))
}
