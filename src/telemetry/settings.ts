/**
 * Telemetry kill-switch and retention budget, both read synchronously from
 * `~/.astrale/config.json` with env overrides. Off when ASTRALE_TELEMETRY is
 * 0/false/off, or when config telemetry.enabled is false; on by default.
 * Every read silent-fails to the default — a broken config must never break
 * the CLI, and must never leave the session store unbounded.
 */
import { readFileSync } from 'node:fs'

import { createPaths } from '../state/index'

const OFF_VALUES = new Set(['0', 'false', 'off'])

/** Sessions idle longer than this are dropped: a month-old session has nothing
 *  left to say, and the harness transcripts its report would cite are gone. */
export const DEFAULT_MAX_AGE_DAYS = 30

/** Hard ceiling on the whole session store. At ~35 KB per session that is some
 *  1,400 sessions — never reached in normal use. It exists for the pathological
 *  case: the analyzer runs with Write inside the session directory, so a single
 *  session can grow without bound. */
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024

type TelemetryConfig = {
  enabled?: boolean
  maxAgeDays?: number
  maxBytes?: number
}

/** The `telemetry` block, or {} when the config is missing or unreadable. */
function readConfig(): TelemetryConfig {
  try {
    // Call-time path resolution — see sessionsRoot() in store.ts for why.
    const parsed = JSON.parse(readFileSync(createPaths().config, 'utf-8')) as {
      telemetry?: TelemetryConfig
    }
    const telemetry = parsed.telemetry
    return typeof telemetry === 'object' && telemetry !== null ? telemetry : {}
  } catch {
    /* missing or broken config → defaults */
    return {}
  }
}

/** Whether telemetry recording is enabled for this process. */
export function telemetryEnabled(): boolean {
  const env = process.env.ASTRALE_TELEMETRY
  if (env !== undefined && OFF_VALUES.has(env.trim().toLowerCase())) return false
  return readConfig().enabled !== false
}

/** The two bounds on the session store — see retention.ts for how they apply. */
export type RetentionBudget = {
  maxAgeMs: number
  maxBytes: number
}

/** First finite, strictly positive candidate. Zero, negatives and garbage fall
 *  through to the next candidate (ultimately the default) rather than
 *  disabling the bound, so a typo can never make the store unbounded. */
function firstPositive(candidates: (number | string | undefined)[]): number | null {
  for (const candidate of candidates) {
    if (candidate === undefined) continue
    const n = typeof candidate === 'string' ? Number(candidate.trim()) : candidate
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

/** Resolved retention budget: env over config over defaults. */
export function retentionBudget(): RetentionBudget {
  const config = readConfig()
  const days =
    firstPositive([process.env.ASTRALE_TELEMETRY_MAX_AGE_DAYS, config.maxAgeDays]) ??
    DEFAULT_MAX_AGE_DAYS
  const bytes =
    firstPositive([process.env.ASTRALE_TELEMETRY_MAX_BYTES, config.maxBytes]) ?? DEFAULT_MAX_BYTES
  return { maxAgeMs: days * 24 * 60 * 60 * 1000, maxBytes: bytes }
}
