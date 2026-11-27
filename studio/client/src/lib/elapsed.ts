/**
 * How long a read has run, against the longest it is given. A read that waits on the registry
 * says how long it has waited; past its limit it says it hit that limit instead of spinning on.
 */

import { useEffect, useState } from 'react'

/** "0 s" · "42 s" · "1 min 05 s" · "6 min". */
export function durationWords(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes} min` : `${minutes} min ${String(rest).padStart(2, '0')} s`
}

export interface ReadingClock {
  /** how long the read has run, once it is long enough to be worth saying */
  elapsed: string | undefined
  /** past its limit: it answered nothing in the time it is given */
  overdue: boolean
  limit: string
}

/** Shown once a read has run this long; a quicker answer needs no clock. */
const SHOWN_AFTER_MS = 1000

/** How long a wait has run, once it is long enough to be worth saying. */
export function elapsedWords(elapsedMs: number): string | undefined {
  return elapsedMs >= SHOWN_AFTER_MS ? durationWords(elapsedMs) : undefined
}

export function readingClock(elapsedMs: number, limitMs: number): ReadingClock {
  return {
    elapsed: elapsedWords(elapsedMs),
    overdue: elapsedMs >= limitMs,
    limit: durationWords(limitMs),
  }
}

/**
 * Milliseconds since `since` — by default, since the component mounted — ticking every second up
 * to `untilMs`.
 */
export function useElapsed(untilMs: number, since?: number): number {
  const [started] = useState(() => since ?? Date.now())
  const [now, setNow] = useState(started)
  const done = now - started >= untilMs
  useEffect(() => {
    if (done) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [done])
  return now - started
}
