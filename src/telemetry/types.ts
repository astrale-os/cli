/**
 * Telemetry contracts. One CLI invocation = one appended event; one session =
 * one directory of evidence under `~/.astrale/sessions/`; harness adapters
 * contribute transcript discovery + a reading guide, never normalization.
 */

/** One CLI invocation, one JSON line in events.jsonl. */
export type TelemetryEvent = {
  /** Envelope version. */
  v: 1
  /** ISO timestamp at process start. */
  ts: string
  /** argv after the binary name, secrets redacted (see redact.ts). */
  argv: string[]
  exitCode: number
  durationMs: number
  /** Error class name when the command threw (AstraleError code preferred). */
  errorName?: string
  cwd: string
  /** Workspace root the session is bucketed by (git root, else cwd). */
  root: string
  /** Which surface produced the event. */
  surface: 'cli'
}

/** Written once when a session directory is created. */
export type SessionMeta = {
  id: string
  root: string
  /** true when the id came from ASTRALE_SESSION (a surface owns the lifecycle). */
  explicit: boolean
  createdAt: string
}

/** Written by the analyzer when it finishes with a session (any outcome). */
export type AnalyzedMarker = {
  analyzedAt: string
  outcome: 'skipped-quiet' | 'reported' | 'filed' | 'error'
  note?: string
}

/** An agent-harness session discovered on this machine (transcript = evidence). */
export type HarnessSession = {
  harness: string
  sessionId?: string
  transcriptPath: string
  cwd?: string
  startedAt?: string
  endedAt?: string
  sizeBytes: number
}

/** Deterministic signals extracted from events.jsonl — the free gate's input. */
export type SessionSignals = {
  eventCount: number
  /** Events with a non-zero exit, grouped by leading command tokens. */
  failures: { command: string; count: number; errorNames: string[] }[]
  /** Same leading command tokens re-run 3+ times (retry smell). */
  retries: { command: string; count: number }[]
  firstEventAt?: string
  lastEventAt?: string
  /** Harness transcripts overlapping this session's root + time window. */
  harnessSessions: HarnessSession[]
}
