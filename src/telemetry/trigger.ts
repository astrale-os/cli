/**
 * Opportunistic analysis trigger — the `git gc --auto` model. Each CLI start
 * cheaply scans for a closed, unanalyzed session and spawns ONE detached
 * analyzer for it when the analyzer is explicitly enabled. No daemon, no cron;
 * a lockfile keeps it single-flight.
 * The same scan pays for the age sweep (see retention.ts), which is why the
 * store stays bounded without anything resembling a background job.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MAX_REMOVALS_ON_START, sweepByAge } from './retention'
import { analyzerEnabled, telemetryEnabled } from './settings'
import { scanSessions, sessionsRoot, type SessionScan } from './store'

const LOCK_STALE_MS = 30 * 60 * 1000

function lockPath(): string {
  return join(sessionsRoot(), '.analyzer.lock')
}

/** True when the lock is free (or stale/dead) and was claimed. */
function claimLock(): boolean {
  const path = lockPath()
  try {
    if (existsSync(path)) {
      const lock = JSON.parse(readFileSync(path, 'utf-8')) as { pid: number; at: number }
      const stale = Date.now() - lock.at > LOCK_STALE_MS
      let alive = false
      try {
        process.kill(lock.pid, 0)
        alive = true
      } catch {
        /* dead */
      }
      if (alive && !stale) return false
      unlinkSync(path)
    }
    mkdirSync(sessionsRoot(), { recursive: true })
    writeFileSync(path, JSON.stringify({ pid: process.pid, at: Date.now() }))
    return true
  } catch {
    return false
  }
}

/** Release only in the parent that claimed; the child rewrites its own. */
export function releaseLock(): void {
  try {
    unlinkSync(lockPath())
  } catch {
    /* already gone */
  }
}

/**
 * Fire-and-forget: spawn a detached `astrale session analyze <id> --auto` for
 * the most recently closed unanalyzed session, if any. Never throws, never
 * blocks — worst case a few ms of directory stats.
 */
export function maybeTriggerAnalysis(argv: string[], scan?: readonly SessionScan[]): void {
  try {
    if (process.env.ASTRALE_TELEMETRY_NO_TRIGGER === '1') return

    const sessions = scan ?? scanSessions()
    // Retention runs ahead of the recording/analyzer switches and on `session`
    // commands too — turning either off must still drain old on-disk evidence.
    const swept = new Set(sweepByAge(sessions, { limit: MAX_REMOVALS_ON_START }).removed)

    if (!telemetryEnabled() || !analyzerEnabled()) return
    // Never cascade off the session commands themselves.
    if (argv[2] === 'session') return

    const target = sessions.find(
      (s) => s.closed && !s.analyzed && s.lastEventAt !== null && !swept.has(s.id),
    )
    if (!target) return
    if (!claimLock()) return

    // Re-invoke self: execPath is bun/node (dev) or the compiled binary; when
    // argv[1] is a real script path, keep it as the first argument. In a
    // bun-compiled binary argv[1] is a virtual /$bunfs/ path that must NOT be
    // passed — the binary re-runs itself from execPath alone.
    const script = process.argv[1]
    const args =
      script && script !== process.execPath && !script.startsWith('/$bunfs') ? [script] : []
    args.push('session', 'analyze', target.id, '--auto')
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ASTRALE_TELEMETRY_NO_TRIGGER: '1' },
    })
    child.unref()
    // The lock hands over to the child: it re-stamps with its own pid on start.
  } catch {
    /* telemetry must never affect the CLI */
  }
}

/** Called by `session analyze --auto` to take over the parent's claim. */
export function restampLock(): void {
  try {
    writeFileSync(lockPath(), JSON.stringify({ pid: process.pid, at: Date.now() }))
  } catch {
    /* best effort */
  }
}
