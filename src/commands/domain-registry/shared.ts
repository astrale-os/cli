import chalk from 'chalk'

import type { AdminRegistryApi } from '../../admin/registry'
import type { KernelCommandOpts } from '../../connection'
import type { AdminTargetCommandOpts } from '../../lib/admin-target'

import { connectAdminRegistry, RegistryError, registryFailure } from '../../admin/registry'
import { withAdminClientSession } from '../../connection'
import { resolveTimeoutMs } from '../../connection/session'
import { AstraleError } from '../../errors'
import { printFailureDebug } from '../../lib/failure-debug'
import { log } from '../../lib/log'

export type RegistryCommandOpts = KernelCommandOpts & AdminTargetCommandOpts

/** The CT29 error document every registry command prints on stdout in machine mode. */
export interface RegistryErrorDocument {
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details?: Readonly<Record<string, unknown>>
  }
}

export interface RegistryCommandDependencies {
  /** Opens the configured Admin target with the caller's own credential. */
  readonly open?: <Value>(
    opts: RegistryCommandOpts,
    work: (registry: AdminRegistryApi) => Promise<Value>,
  ) => Promise<Value>
  readonly write?: (text: string) => void
}

/**
 * Run one registry command on the Admin target: print one document on stdout and answer 0, or
 * print one refusal (the CT29 error document on stdout in machine mode, a diagnostic on stderr for
 * a person) and answer 1. Never prints a partial result.
 */
export async function runRegistryCommand<Admitted, Value>(input: {
  readonly opts: RegistryCommandOpts
  readonly machine: boolean
  readonly action: 'read' | 'change'
  /** Admit the arguments and stdin before any connection, so a bad input costs no request. */
  readonly admit: () => Admitted | Promise<Admitted>
  readonly work: (registry: AdminRegistryApi, admitted: Admitted) => Promise<Value>
  readonly present?: (value: Value) => void
  readonly dependencies?: RegistryCommandDependencies
}): Promise<number> {
  const open = input.dependencies?.open ?? openRegistry
  const write = input.dependencies?.write ?? ((text: string) => void process.stdout.write(text))
  let value: Value
  try {
    const admitted = await input.admit()
    value = await open(input.opts, (registry) => input.work(registry, admitted))
  } catch (cause) {
    const error = registryFailure(cause, input.action)
    if (input.machine) write(`${JSON.stringify(registryErrorDocument(error), null, 2)}\n`)
    else renderRegistryError(error)
    if (input.opts.debug) printFailureDebug(cause, '')
    return 1
  }
  if (input.machine || input.present === undefined) write(`${JSON.stringify(value, null, 2)}\n`)
  else input.present(value)
  return 0
}

export function registryErrorDocument(error: AstraleError): RegistryErrorDocument {
  const details =
    error instanceof RegistryError
      ? error.details
      : error.hint === undefined
        ? undefined
        : Object.freeze({ hint: error.hint })
  return Object.freeze({
    error: Object.freeze({
      code: error.code,
      message: error.message,
      ...(details === undefined ? {} : { details }),
    }),
  })
}

/** Read the whole of stdin, bounded: the publish request is one small JSON document. */
export async function readRequest(
  stdin: AsyncIterable<Uint8Array | string> & { readonly isTTY?: boolean } = process.stdin,
  maximumBytes = 64 * 1_024,
): Promise<unknown> {
  if (stdin.isTTY === true) {
    throw new AstraleError(
      'INVALID_INPUT',
      'The publish request is read from stdin as one astrale.registry-publish-request JSON document.',
    )
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stdin) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > maximumBytes)
      throw new AstraleError('INVALID_INPUT', `The publish request exceeds ${maximumBytes} bytes.`)
    chunks.push(bytes)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new AstraleError('INVALID_INPUT', 'The publish request on stdin is not valid JSON.')
  }
}

function openRegistry<Value>(
  opts: RegistryCommandOpts,
  work: (registry: AdminRegistryApi) => Promise<Value>,
): Promise<Value> {
  return withAdminClientSession(opts, async (context) =>
    // `--timeout` bounds each read of a published deployment as it bounds each Admin request.
    work(
      connectAdminRegistry({
        ...context,
        deployment: { timeoutMs: resolveTimeoutMs(opts.timeout) },
      }),
    ),
  )
}

function renderRegistryError(error: AstraleError): void {
  log.error(`${chalk.bold(error.code)}: ${error.message}`)
  const details = error instanceof RegistryError ? error.details : undefined
  const existing = details?.existing as { readonly releaseDigest?: string } | undefined
  if (existing?.releaseDigest !== undefined)
    log.dim(`  existing release: ${existing.releaseDigest}`)
  if (error.hint) log.dim(`  ${error.hint}`)
}
