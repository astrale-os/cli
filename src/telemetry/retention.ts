/**
 * Session-store retention: two bounds, applied in that order.
 *
 * Age is a RELEVANCE bound — a session idle for a month has nothing left to
 * say, and the harness transcripts its report would cite are long gone. It is
 * free to enforce (scanSessions already stats every events.jsonl), so it runs
 * on every CLI start, telemetry on or off: switching telemetry off must mean
 * "and clean up what is already there", not "freeze the store forever".
 *
 * Size is a SAFETY bound — the analyzer runs with Write inside the session
 * directory, so one pathological session can grow without limit. Enforcing it
 * means stat-ing every file of every session, so it runs only in the detached
 * analyzer, never on the user's critical path.
 *
 * Neither bound replaces the other: age bounds what is worth keeping, size
 * bounds what can go wrong. Both are configurable — see settings.ts.
 */
import { type Dirent, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import type { RetentionBudget } from './settings'
import type { SessionScan } from './store'

import { retentionBudget } from './settings'
import { readMarker, scanSessions, sessionBytes, sessionDir } from './store'

/** What an analyzed session is allowed to keep. Everything else is scratch: the
 *  analyzer runs with Write inside the session directory, so without this a
 *  session's size is whatever the agent felt like writing — one here was left
 *  holding a 462 KB calls.txt, a quarter of the entire store. */
const KEEP = new Set(['meta.json', 'events.jsonl', 'report.md', '.analyzed', 'analyzer.log'])

/** Reproducible from events.jsonl in the normal case, and dropped there — but
 *  it is the only record of what the analyzer was actually asked when it
 *  failed, which is exactly when someone will want to look. */
const ANALYZER_PROMPT = 'analyzer-prompt.md'

/**
 * Reduce one session to its durable artifacts, called once the analyzer has
 * written its marker. This is what makes a session's footprint a property of
 * the CLI rather than of whatever the agent decided to leave behind.
 */
export function tidySession(id: string, options: { keepPrompt?: boolean } = {}): string[] {
  const dir = sessionDir(id)
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const removed: string[] = []
  for (const entry of entries) {
    if (KEEP.has(entry.name)) continue
    if (entry.name === ANALYZER_PROMPT && options.keepPrompt === true) continue
    try {
      rmSync(join(dir, entry.name), { recursive: true, force: true })
      removed.push(entry.name)
    } catch {
      /* best effort — tidying must never fail the analysis it follows */
    }
  }
  return removed
}

/** Cap for the age sweep on the CLI's critical path, so a large backlog drains
 *  over several runs instead of stalling one command on hundreds of rmSync. */
export const MAX_REMOVALS_ON_START = 20

export type SweepOptions = {
  /** Defaults to the resolved config budget. */
  budget?: RetentionBudget
  now?: number
  /** Cap on removals; unbounded when omitted. */
  limit?: number
  /** Ids that must survive — the session being recorded or analyzed right now. */
  protect?: ReadonlySet<string>
}

/** Session ids removed, in removal order. */
export type SweepResult = { removed: string[] }

function remove(id: string, into: string[]): void {
  try {
    rmSync(sessionDir(id), { recursive: true, force: true })
    into.push(id)
  } catch {
    /* best effort — retention must never affect the CLI */
  }
}

/**
 * Drop every session whose last activity predates the age bound, analyzed or
 * not: a session that went a month without being analyzed never will be.
 * Sessions with no events yet are exempt — one of them is the invocation
 * running right now, created by ensureSession and not written until exit.
 */
export function sweepByAge(
  sessions: readonly SessionScan[],
  options: SweepOptions = {},
): SweepResult {
  const { maxAgeMs } = options.budget ?? retentionBudget()
  const cutoff = (options.now ?? Date.now()) - maxAgeMs
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  const protect = options.protect
  const removed: string[] = []
  for (const session of sessions) {
    if (removed.length >= limit) break
    if (protect?.has(session.id)) continue
    if (session.lastEventAt !== null && session.lastEventAt.getTime() < cutoff) {
      remove(session.id, removed)
    }
  }
  return { removed }
}

/**
 * Trim the store to the size bound, evicting oldest-first and analyzed before
 * unanalyzed — an analyzed session has already handed its evidence to a report,
 * an unanalyzed one has not. Open sessions are never touched: one of them is
 * being recorded right now.
 */
export function sweepToBudget(
  sessions: readonly SessionScan[],
  options: SweepOptions = {},
): SweepResult {
  const { maxBytes } = options.budget ?? retentionBudget()
  const protect = options.protect
  const removed: string[] = []

  const sized = sessions.map((session) => ({ session, bytes: sessionBytes(session.id) }))
  let total = sized.reduce((sum, entry) => sum + entry.bytes, 0)
  if (total <= maxBytes) return { removed }

  // Oldest first; a session with no events yet sorts to the front — it holds
  // nothing but a meta.json, so it is the cheapest thing to lose.
  const evictable = sized
    .filter((entry) => entry.session.closed && !protect?.has(entry.session.id))
    .sort(
      (a, b) => (a.session.lastEventAt?.getTime() ?? 0) - (b.session.lastEventAt?.getTime() ?? 0),
    )

  for (const analyzedFirst of [true, false]) {
    for (const entry of evictable) {
      if (total <= maxBytes) return { removed }
      if (entry.session.analyzed !== analyzedFirst) continue
      const before = removed.length
      remove(entry.session.id, removed)
      if (removed.length > before) total -= entry.bytes
    }
  }
  return { removed }
}

/**
 * Both bounds over the live store, for the detached analyzer: age first (cheap,
 * and it may free enough on its own), then size over whatever survives.
 */
export function sweepStore(options: SweepOptions = {}): SweepResult {
  const budget = options.budget ?? retentionBudget()
  const sessions = scanSessions()
  const byAge = sweepByAge(sessions, { ...options, budget })
  const gone = new Set(byAge.removed)
  const survivors = sessions.filter((session) => !gone.has(session.id))

  // Tidy before measuring. Doing it after would let a session be evicted for
  // holding scratch that was about to be deleted anyway — and it is what makes
  // the artifact bound retroactive rather than only applying to new analyses.
  for (const session of survivors) {
    if (session.analyzed) {
      tidySession(session.id, { keepPrompt: readMarker(session.id)?.outcome === 'error' })
    }
  }

  const bySize = sweepToBudget(survivors, { ...options, budget })
  return { removed: [...byAge.removed, ...bySize.removed] }
}
