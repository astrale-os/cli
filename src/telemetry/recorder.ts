/**
 * Recorder: the shim-facing telemetry entrypoint. beginInvocation captures a
 * start time and returns a finalizer that appends one TelemetryEvent line when
 * the process ends. Fully synchronous (safe inside process 'exit') and never
 * throws — a telemetry failure can't affect the CLI.
 */
import { appendFileSync } from 'node:fs'

import type { TelemetryEvent } from './types'

import { redactArgv } from './redact'
import { ensureSession } from './session'
import { telemetryEnabled } from './settings'
import { eventsPath } from './store'

/** Called once the command has resolved: records exit code + optional error. */
export type Finalizer = (exitCode: number, errorName?: string) => void

const NOOP: Finalizer = () => {}
const HELP_VERSION = new Set([
  '-h',
  '--help',
  '-V',
  '--version',
  '--cli-version',
  'help',
  'version',
])

/** Bare invocation (every() is true for []) or only help/version tokens — skip. */
function isHelpOrVersion(args: string[]): boolean {
  return args.every((a) => HELP_VERSION.has(a))
}

/** Begin recording an invocation; returns a finalizer to call at process end. */
export function beginInvocation(argv: string[]): Finalizer {
  try {
    const args = argv.slice(2)
    if (!telemetryEnabled() || isHelpOrVersion(args)) return NOOP
    const startMs = Date.now()
    const ts = new Date(startMs).toISOString()
    const cwd = process.cwd()
    const { id, root } = ensureSession(cwd)
    return (exitCode: number, errorName?: string) => {
      try {
        const event: TelemetryEvent = {
          v: 1,
          ts,
          argv: redactArgv(args),
          exitCode,
          durationMs: Date.now() - startMs,
          cwd,
          root,
          surface: 'cli',
        }
        if (errorName) event.errorName = errorName
        appendFileSync(eventsPath(id), JSON.stringify(event) + '\n')
      } catch {
        /* telemetry must never affect the CLI */
      }
    }
  } catch {
    return NOOP
  }
}
