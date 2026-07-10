/**
 * The free gate: deterministic signals from a session's events.jsonl. No LLM —
 * quiet sessions must die here at zero cost. Harness transcripts are attached
 * by the analyzer (adapters), not here.
 */
import { readFileSync } from 'node:fs'

import type { SessionSignals, TelemetryEvent } from './types'

const RETRY_THRESHOLD = 3

/** Leading command tokens (sub-command path), flags and values excluded. */
export function commandHead(argv: string[]): string {
  const head: string[] = []
  for (const a of argv) {
    if (a.startsWith('-') || a.includes('=') || head.length >= 2) break
    head.push(a)
  }
  return head.join(' ') || '(bare)'
}

export function readEvents(eventsPath: string): TelemetryEvent[] {
  let raw: string
  try {
    raw = readFileSync(eventsPath, 'utf-8')
  } catch {
    return []
  }
  const events: TelemetryEvent[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line) as TelemetryEvent)
    } catch {
      /* torn line (crash mid-append) — skip */
    }
  }
  return events
}

export function extractSignals(events: TelemetryEvent[]): SessionSignals {
  const byCommand = new Map<string, TelemetryEvent[]>()
  for (const e of events) {
    const head = commandHead(e.argv)
    const bucket = byCommand.get(head)
    if (bucket) bucket.push(e)
    else byCommand.set(head, [e])
  }

  const failures: SessionSignals['failures'] = []
  const retries: SessionSignals['retries'] = []
  for (const [command, evts] of byCommand) {
    const failed = evts.filter((e) => e.exitCode !== 0)
    if (failed.length > 0) {
      failures.push({
        command,
        count: failed.length,
        errorNames: [...new Set(failed.map((e) => e.errorName).filter((n): n is string => !!n))],
      })
    }
    if (evts.length >= RETRY_THRESHOLD) retries.push({ command, count: evts.length })
  }

  return {
    eventCount: events.length,
    failures,
    retries,
    firstEventAt: events[0]?.ts,
    lastEventAt: events[events.length - 1]?.ts,
    harnessSessions: [],
  }
}

/** Worth waking a model for? Failures, retry smells, or harness transcripts. */
export function hasSignals(signals: SessionSignals): boolean {
  return (
    signals.failures.length > 0 || signals.retries.length > 0 || signals.harnessSessions.length > 0
  )
}
