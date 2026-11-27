/**
 * Exact Astrale CLI bridge for Studio.
 *
 * The launching `astrale studio` process passes its runtime + entrypoint through a versioned
 * descriptor. Every Studio CLI delegation uses that exact pair; this module never falls back to
 * resolving an unrelated `astrale` binary from PATH.
 */
import { isAbsolute } from 'node:path'

import { asJsonRecord, asStringArray, parseJson, type JsonDecoder } from './json'
import { captureProcess, type CapturedProcess, type ChildOptions } from './process'

export const STUDIO_CLI_DESCRIPTOR_ENV = 'DOMAIN_STUDIO_CLI_DESCRIPTOR'

interface StudioCliDescriptor {
  version: 1
  executable: string
  args: string[]
}

interface StudioCliResult {
  ok: boolean
  detail: string
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

interface RunOptions extends ChildOptions {
  acceptedExitCodes?: readonly number[]
}

function decodeStudioCliDescriptor(value: string | undefined): StudioCliDescriptor | null {
  if (!value) return null
  const parsed = asJsonRecord(parseJson(value))
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

function conciseCliFailure(raw: string): string | undefined {
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
  const object = asJsonRecord(value)
  return (
    nonEmptyString(object?.message) ??
    nonEmptyString(object?.error) ??
    conciseCliFailure(stderr) ??
    conciseCliFailure(stdout) ??
    ''
  )
}

/** A command's JSON answer on one stream, or undefined when that stream holds none. */
function parseOutput(text: string): unknown {
  const normalized = text.replace(/^\uFEFF/, '').trim()
  return normalized ? parseJson(normalized) : undefined
}

/** Why a finished run failed: its spawn error, its timeout, or what its output says. */
function captureDetail(
  captured: CapturedProcess,
  options: RunOptions,
  fromOutput: () => string,
): string {
  return (
    captured.spawnError ??
    (captured.timedOut ? `Astrale CLI timed out after ${options.timeoutMs}ms` : fromOutput())
  )
}

/** Run the launching Astrale CLI with `args` and capture it; a missing descriptor is a spawn failure. */
export async function captureStudioCli(
  args: readonly string[],
  options: ChildOptions,
): Promise<CapturedProcess> {
  let command: string[]
  try {
    // Resolving the command throws when the descriptor is missing; that too is a spawn failure.
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
  return captureProcess(command, options)
}

export async function runStudioCliJson<T>(
  args: readonly string[],
  decoder: JsonDecoder<T>,
  options: RunOptions,
): Promise<StudioCliResult & { data: T | undefined }> {
  const machineArgs = args.includes('--json') ? [...args] : [...args, '--json']
  const captured = await captureStudioCli(machineArgs, options)
  const value = parseOutput(captured.stdout) ?? parseOutput(captured.stderr)
  const data = value === undefined ? undefined : decoder(value)
  const accepted = options.acceptedExitCodes ?? [0]
  const detail = captureDetail(captured, options, () =>
    resultDetail(value, captured.stdout, captured.stderr),
  )
  return {
    ok: accepted.includes(captured.exitCode) && data !== undefined && !captured.timedOut,
    data,
    detail,
    exitCode: captured.exitCode,
    stdout: captured.stdout,
    stderr: captured.stderr,
    timedOut: captured.timedOut,
  }
}

export async function runStudioCliText(
  args: readonly string[],
  options: RunOptions,
): Promise<StudioCliResult> {
  const captured = await captureStudioCli(args, options)
  const accepted = options.acceptedExitCodes ?? [0]
  const detail = captureDetail(
    captured,
    options,
    () => conciseCliFailure(captured.stderr) ?? conciseCliFailure(captured.stdout) ?? '',
  )
  return {
    ok: accepted.includes(captured.exitCode) && !captured.timedOut,
    detail,
    exitCode: captured.exitCode,
    stdout: captured.stdout,
    stderr: captured.stderr,
    timedOut: captured.timedOut,
  }
}
