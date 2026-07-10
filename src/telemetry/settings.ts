/**
 * Telemetry kill-switch, evaluated synchronously at process start/exit.
 * Off when ASTRALE_TELEMETRY is 0/false/off, or when config telemetry.enabled
 * is false; on by default. Every read silent-fails to enabled.
 */
import { readFileSync } from 'node:fs'

import { createPaths } from '../lib/env'

const OFF_VALUES = new Set(['0', 'false', 'off'])

/** Whether telemetry recording is enabled for this process. */
export function telemetryEnabled(): boolean {
  const env = process.env.ASTRALE_TELEMETRY
  if (env !== undefined && OFF_VALUES.has(env.trim().toLowerCase())) return false
  try {
    // Call-time path resolution — see sessionsRoot() in store.ts for why.
    const parsed = JSON.parse(readFileSync(createPaths().config, 'utf-8')) as {
      telemetry?: { enabled?: boolean }
    }
    if (parsed.telemetry?.enabled === false) return false
  } catch {
    /* missing or broken config → default on */
  }
  return true
}
