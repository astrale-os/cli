import { spawn } from 'node:child_process'

import { captureProcess } from '../../process'

export interface CapturedCommand {
  code: number
  stdout: string
  stderr: string
  aborted?: boolean
  timedOut?: boolean
}

export interface CaptureOptions {
  env?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
}

/** Merge overrides into the spawned harness only. */
export function childEnvironment(extra?: Record<string, string>): NodeJS.ProcessEnv | undefined {
  return extra && Object.keys(extra).length ? { ...process.env, ...extra } : undefined
}

/**
 * Capture a short-lived local command such as gateway-token minting, through the Studio's
 * runner (process.ts): bounded, in its own process group, 15 s unless `timeoutMs` says.
 */
export async function captureCommand(
  bin: string,
  args: string[],
  cwd: string,
  options: CaptureOptions = {},
): Promise<CapturedCommand> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const run = await captureProcess([bin, ...args], {
    cwd,
    timeoutMs,
    ...(options.env && Object.keys(options.env).length ? { env: options.env } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (run.aborted) return { code: -1, stdout: run.stdout, stderr: 'canceled', aborted: true }
  if (run.timedOut)
    return {
      code: -1,
      stdout: run.stdout,
      stderr: `command timed out after ${timeoutMs}ms`,
      timedOut: true,
    }
  if (run.spawnError) return { code: -1, stdout: run.stdout, stderr: run.spawnError }
  return { code: run.exitCode, stdout: run.stdout, stderr: run.stderr }
}

/** Terminate the whole harness process group so child commands cannot leak. */
export function terminateProcessTree(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals = 'SIGTERM',
): void {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      /* already gone */
    }
  }
}
