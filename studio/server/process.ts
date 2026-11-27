/**
 * process.ts — the one way the Studio runs a child process to completion.
 *
 * - A command is an argv array, never a shell line: each argument reaches the program verbatim.
 * - Every run names its deadline. Past it the child's whole process group is killed, its
 *   attached children with it, whatever signals they ignore.
 * - Both streams are read while the child runs, so a child never blocks on a full pipe.
 * - At most `CHILD_LIMITS.running` children run at once, Studio-wide. One more waits for a slot
 *   in arrival order, and its deadline starts when it starts. At most `CHILD_LIMITS.waiting`
 *   wait; one more is refused at once (`spawnError`), as is one whose caller gave up waiting.
 * - A value a caller places as an operand is checked by `operandProblem` first: one that starts
 *   with `-` would be read as an option.
 *
 * Never throws: a child that could not start answers `exitCode` -1 and why. Long-lived children
 * with a lifecycle of their own — an agent harness session, a View session server — are not
 * run here.
 */
import type { Readable } from 'node:stream'

import { spawn } from 'node:child_process'

/** How one child is run. */
export interface ChildOptions {
  readonly cwd?: string
  /** added to this process's environment */
  readonly env?: Record<string, string>
  /** past it, from the child's start, its whole process group is killed */
  readonly timeoutMs: number
  /** the caller gave up: a waiting child leaves the queue, a running one is killed */
  readonly signal?: AbortSignal
  readonly onStderr?: (chunk: string) => void
}

export interface CapturedProcess {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  aborted?: true
  spawnError?: string
}

/** How many children run at once, Studio-wide, and how many may wait for a slot. */
export const CHILD_LIMITS = { running: 6, waiting: 64 } as const

export type ChildRunner = (
  command: readonly string[],
  options: ChildOptions,
) => Promise<CapturedProcess>

const failure = (spawnError: string): CapturedProcess => ({
  exitCode: -1,
  stdout: '',
  stderr: '',
  timedOut: false,
  spawnError,
})

const abandoned = (): CapturedProcess => ({
  exitCode: -1,
  stdout: '',
  stderr: '',
  timedOut: false,
  aborted: true,
})

/** Why `value` may not stand as an operand in a command line, or nothing when it may. */
export function operandProblem(value: string, what: string): string | undefined {
  if (value.length === 0) return `${what} is empty`
  if (value.startsWith('-'))
    return `${what} ${JSON.stringify(value)} starts with "-", which a command reads as an option`
  return undefined
}

/** A runner bounded by `limits`; `captureProcess` is the Studio's own. */
export function createChildRunner(limits: { running: number; waiting: number }): ChildRunner {
  let running = 0
  const queue: { start: () => void }[] = []

  const release = () => {
    running -= 1
    const next = queue.shift()
    if (next) next.start()
  }

  /** A slot, once one is free: `release` gives it back. */
  function slot(signal: AbortSignal | undefined): Promise<'started' | 'full' | 'aborted'> {
    if (signal?.aborted) return Promise.resolve('aborted')
    if (running < limits.running) {
      running += 1
      return Promise.resolve('started')
    }
    if (queue.length >= limits.waiting) return Promise.resolve('full')
    return new Promise((resolve) => {
      const onAbort = () => {
        const at = queue.indexOf(waiter)
        if (at >= 0) queue.splice(at, 1)
        resolve('aborted')
      }
      const waiter = {
        start: () => {
          signal?.removeEventListener('abort', onAbort)
          running += 1
          resolve('started')
        },
      }
      queue.push(waiter)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  return async (command, options) => {
    if (command.length === 0 || !command[0]) return failure('no command to run')
    if (!(options.timeoutMs > 0)) return failure('a child runs within a deadline')
    const started = await slot(options.signal)
    if (started === 'aborted') return abandoned()
    if (started === 'full')
      return failure(
        `the Studio already runs ${limits.running} processes and ${limits.waiting} wait: try again`,
      )
    try {
      return await run(command, options)
    } finally {
      release()
    }
  }
}

/** The Studio's runner: every child it runs to completion goes through it. */
export const captureProcess: ChildRunner = createChildRunner(CHILD_LIMITS)

/** One child, from start to its close, in its own process group with stdin closed. */
async function run(command: readonly string[], options: ChildOptions): Promise<CapturedProcess> {
  try {
    return await new Promise<CapturedProcess>((resolve) => {
      const grouped = process.platform !== 'win32'
      // Keep a live group leader until capture ends, even if the command exits first and an
      // attached child retains a pipe. The private fd announces the command's exit; the shell
      // closes its own output descriptors and waits for our release. "$@" preserves argv
      // verbatim. This prevents both orphaned children and signaling a reused leader PID.
      const invocation = grouped
        ? [
            '/bin/sh',
            '-c',
            '"$@" </dev/null 3>&-\ncode=$?\nprintf "%s\\n" "$code" >&3\nexec 1>&- 2>&- 3>&-\nread -r release\nexit "$code"',
            'astrale-studio-child',
            ...command,
          ]
        : [...command]
      const proc = spawn(invocation[0]!, invocation.slice(1), {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
        stdio: grouped ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
        detached: grouped,
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let aborted = false
      let exited = false
      let spawnError: string | undefined
      let commandExitCode: number | undefined
      let stdoutEnded = false
      let stderrEnded = false
      const release = () => {
        if (stdoutEnded && stderrEnded && commandExitCode !== undefined) proc.stdin?.end('\n')
      }
      proc.stdin?.on('error', () => {
        /* The deadline may close the leader before release. */
      })
      const stdoutStream = proc.stdout!
      const stderrStream = proc.stderr!
      stdoutStream.setEncoding('utf8')
      stderrStream.setEncoding('utf8')
      stdoutStream.on('data', (chunk: string) => {
        stdout += chunk
      })
      stderrStream.on('data', (chunk: string) => {
        stderr += chunk
        options.onStderr?.(chunk)
      })
      stdoutStream.once('end', () => {
        stdoutEnded = true
        release()
      })
      stderrStream.once('end', () => {
        stderrEnded = true
        release()
      })
      if (grouped) {
        const outcome = proc.stdio[3] as Readable
        let code = ''
        outcome.setEncoding('utf8')
        outcome.on('data', (chunk: string) => {
          code += chunk
        })
        outcome.once('end', () => {
          if (/^\d+\n$/.test(code)) commandExitCode = Number(code.trim())
          release()
        })
      }
      proc.once('error', (error) => {
        spawnError = error.message
      })
      proc.once('exit', () => {
        exited = true
      })
      // A hard stop: reap the whole group even if it ignores SIGTERM, then release our reads,
      // since an independently detached child may retain a descriptor. `close` still waits for
      // the owned process to be reaped.
      const stop = () => {
        if (!exited && proc.pid !== undefined) {
          try {
            if (grouped) process.kill(-proc.pid, 'SIGKILL')
            else proc.kill('SIGKILL')
          } catch {
            try {
              proc.kill('SIGKILL')
            } catch {
              /* Already exited. */
            }
          }
        }
        stdoutStream.destroy()
        stderrStream.destroy()
        if (grouped) (proc.stdio[3] as Readable).destroy()
      }
      const timer = setTimeout(() => {
        timedOut = true
        stop()
      }, options.timeoutMs)
      const onAbort = () => {
        aborted = true
        stop()
      }
      // a caller that gave up between its slot and this start is not left running
      if (options.signal?.aborted) onAbort()
      else options.signal?.addEventListener('abort', onAbort, { once: true })
      proc.once('close', (exitCode) => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        resolve({
          exitCode: commandExitCode ?? exitCode ?? -1,
          stdout,
          stderr,
          timedOut,
          ...(aborted ? { aborted: true as const } : {}),
          ...(spawnError ? { spawnError } : {}),
        })
      })
    })
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}
