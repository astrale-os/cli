/**
 * Exact Astrale CLI bridge for Studio.
 *
 * The launching `astrale studio` process passes its runtime + entrypoint through a versioned
 * descriptor. Every Studio CLI delegation uses that exact pair; this module never falls back to
 * resolving an unrelated `astrale` binary from PATH.
 */
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

async function captureStudioCli(
  args: readonly string[],
  options: RunOptions,
): Promise<CapturedProcess> {
  let command: string[]
  try {
    command = studioCliCommand(args)
  } catch (error) {
    return {
      exitCode: -1,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnError: error instanceof Error ? error.message : String(error),
    }
  }

  try {
    const proc = Bun.spawn(command, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    let timedOut = false
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          try {
            proc.kill()
          } catch {
            // Already exited.
          }
        }, options.timeoutMs)
      : undefined
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      return { exitCode, stdout, stderr, timedOut }
    } finally {
      if (timer) clearTimeout(timer)
    }
  } catch (error) {
    return {
      exitCode: -1,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnError: error instanceof Error ? error.message : String(error),
    }
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
  const detail =
    captured.spawnError ??
    (captured.timedOut
      ? `Astrale CLI timed out after ${options.timeoutMs ?? 0}ms`
      : resultDetail(value, captured.stdout, captured.stderr))
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
  const detail =
    captured.spawnError ??
    (captured.timedOut
      ? `Astrale CLI timed out after ${options.timeoutMs ?? 0}ms`
      : (conciseCliFailure(captured.stderr) ?? conciseCliFailure(captured.stdout) ?? ''))
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
