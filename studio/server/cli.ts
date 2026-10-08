import type { Readable } from 'node:stream'

/**
 * Exact Astrale CLI bridge for Studio.
 *
 * The launching `astrale studio` process passes its runtime + entrypoint through a versioned
 * descriptor. Every Studio CLI delegation uses that exact pair; this module never falls back to
 * resolving an unrelated `astrale` binary from PATH.
 */
import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'

import { asJsonRecord, asStringArray, parseJson as parseUntrustedJson } from './json'

export const STUDIO_CLI_DESCRIPTOR_ENV = 'DOMAIN_STUDIO_CLI_DESCRIPTOR'

export interface StudioCliDescriptorV1 {
  version: 1
  executable: string
  args: string[]
}

export type StudioCliDecoder<T> = (value: unknown) => T | null

export interface StudioCliMachineResult<T> {
  version: 1
  ok: boolean
  data: T | null
  value: unknown | null
  detail: string
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface StudioCliTextResult {
  version: 1
  ok: boolean
  detail: string
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

interface RunOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  acceptedExitCodes?: readonly number[]
}

interface CapturedProcess {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  spawnError?: string
}

export function decodeStudioCliDescriptor(value: string | undefined): StudioCliDescriptorV1 | null {
  if (!value) return null
  const parsed = asJsonRecord(parseUntrustedJson(value))
  const args = asStringArray(parsed?.args)
  if (
    parsed?.version !== 1 ||
    typeof parsed.executable !== 'string' ||
    !isAbsolute(parsed.executable) ||
    !args ||
    args.length > 1 ||
    !args.every((arg) => isAbsolute(arg))
  ) {
    return null
  }
  return { version: 1, executable: parsed.executable, args }
}

export function studioCliCommand(
  args: readonly string[],
  encodedDescriptor = process.env[STUDIO_CLI_DESCRIPTOR_ENV],
): string[] {
  const descriptor = decodeStudioCliDescriptor(encodedDescriptor)
  if (!descriptor) {
    throw new Error(
      `${STUDIO_CLI_DESCRIPTOR_ENV} is missing or invalid; launch Studio through this Astrale CLI`,
    )
  }
  return [descriptor.executable, ...descriptor.args, ...args]
}

export function decodeJsonObject(value: unknown): Record<string, unknown> | null {
  return asJsonRecord(value) ?? null
}

export function conciseCliFailure(raw: string): string | undefined {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const error = lines.find((line) => /^[A-Za-z_$][\w$]*(?:Error|Exception):\s+\S/.test(line))
  if (error) return error.slice(0, 600)
  const explicit = lines.find((line) => /^(?:error|failed):\s+\S/i.test(line))
  if (explicit) return explicit.slice(0, 600)
  const useful = lines.find(
    (line) =>
      !/^\d+\s+\|/.test(line) &&
      line !== '^' &&
      !/^at\s/.test(line) &&
      !/^Bun v\d/.test(line) &&
      !/^details?:\s*[{[]?$/i.test(line),
  )
  return useful?.slice(0, 600)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function resultDetail(value: unknown, stdout: string, stderr: string): string {
  const object = decodeJsonObject(value)
  return (
    nonEmptyString(object?.message) ??
    nonEmptyString(object?.error) ??
    conciseCliFailure(stderr) ??
    conciseCliFailure(stdout) ??
    ''
  )
}

function parseJson(text: string): unknown | null {
  const normalized = text.replace(/^\uFEFF/, '').trim()
  if (!normalized) return null
  try {
    return JSON.parse(normalized)
  } catch {
    return null
  }
}

function spawnFailure(error: unknown): CapturedProcess {
  return {
    exitCode: -1,
    stdout: '',
    stderr: '',
    timedOut: false,
    spawnError: error instanceof Error ? error.message : String(error),
  }
}

/** Why a finished run failed: its spawn error, its timeout, or what its output says. */
function captureDetail(
  captured: CapturedProcess,
  options: RunOptions,
  fromOutput: () => string,
): string {
  return (
    captured.spawnError ??
    (captured.timedOut ? `Astrale CLI timed out after ${options.timeoutMs ?? 0}ms` : fromOutput())
  )
}

async function captureStudioCli(
  args: readonly string[],
  options: RunOptions,
): Promise<CapturedProcess> {
  try {
    // Resolving the command throws when the descriptor is missing; that too is a spawn failure.
    const command = studioCliCommand(args)
    return await new Promise<CapturedProcess>((resolve) => {
      const grouped = process.platform !== 'win32'
      // Keep a live group leader until capture ends, even if the CLI exits first and an
      // attached child retains a pipe. The private fd announces the CLI's exit; the shell
      // closes its own output descriptors and waits for our release. "$@" preserves argv
      // verbatim. This prevents both orphaned children and signaling a reused leader PID.
      const invocation = grouped
        ? [
            '/bin/sh',
            '-c',
            '"$@" </dev/null 3>&-\ncode=$?\nprintf "%s\\n" "$code" >&3\nexec 1>&- 2>&- 3>&-\nread -r release\nexit "$code"',
            'astrale-studio-cli',
            ...command,
          ]
        : command
      const proc = spawn(invocation[0], invocation.slice(1), {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
        stdio: grouped ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
        detached: grouped,
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
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
      const timer =
        options.timeoutMs && options.timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true
              // A deadline is a hard stop. Reap the exact child even if it ignores SIGTERM,
              // and stop its attached children rather than leaving one holding the pipes.
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
              // An independently detached child may retain a descriptor after the CLI exits.
              // Release our reads; `close` still waits for the owned CLI process to be reaped.
              stdoutStream.destroy()
              stderrStream.destroy()
              if (grouped) (proc.stdio[3] as Readable).destroy()
            }, options.timeoutMs)
          : undefined
      proc.once('close', (exitCode) => {
        if (timer) clearTimeout(timer)
        resolve({
          exitCode: commandExitCode ?? exitCode ?? -1,
          stdout,
          stderr,
          timedOut,
          ...(spawnError ? { spawnError } : {}),
        })
      })
    })
  } catch (error) {
    return spawnFailure(error)
  }
}

export async function runStudioCliJson<T>(
  args: readonly string[],
  decoder: StudioCliDecoder<T>,
  options: RunOptions = {},
): Promise<StudioCliMachineResult<T>> {
  const machineArgs = args.includes('--json') ? [...args] : [...args, '--json']
  const captured = await captureStudioCli(machineArgs, options)
  const value = parseJson(captured.stdout) ?? parseJson(captured.stderr)
  const data = value === null ? null : decoder(value)
  const accepted = options.acceptedExitCodes ?? [0]
  const detail = captureDetail(captured, options, () =>
    resultDetail(value, captured.stdout, captured.stderr),
  )
  return {
    version: 1,
    ok: accepted.includes(captured.exitCode) && data !== null && !captured.timedOut,
    data,
    value,
    detail,
    exitCode: captured.exitCode,
    stdout: captured.stdout,
    stderr: captured.stderr,
    timedOut: captured.timedOut,
  }
}

export async function runStudioCliText(
  args: readonly string[],
  options: RunOptions = {},
): Promise<StudioCliTextResult> {
  const captured = await captureStudioCli(args, options)
  const accepted = options.acceptedExitCodes ?? [0]
  const detail = captureDetail(
    captured,
    options,
    () => conciseCliFailure(captured.stderr) ?? conciseCliFailure(captured.stdout) ?? '',
  )
  return {
    version: 1,
    ok: accepted.includes(captured.exitCode) && !captured.timedOut,
    detail,
    exitCode: captured.exitCode,
    stdout: captured.stdout,
    stderr: captured.stderr,
    timedOut: captured.timedOut,
  }
}
