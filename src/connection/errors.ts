import { AuthValueError } from '@astrale-os/sdk/auth'
import {
  ClientError,
  NodeUnavailableError,
  ProtocolError,
  ResponseError,
  SessionError,
  TransportError,
  type SessionFailure,
  type TransportContext,
} from '@astrale-os/sdk/client'
import { PathError } from '@astrale-os/sdk/graph/path'
import chalk from 'chalk'

import type { OperationRecovery, PendingFollowUp } from './command'

import { AstraleError } from '../errors'
import { log, printFailureDebug } from '../lib/terminal/log'
import {
  IncompleteInstallation,
  lifecycleFailureNotes,
  OperationConflict,
  renderIncompleteInstallation,
  renderOperationConflict,
  type LifecycleContext,
} from './installation-result'
import {
  CREDENTIAL_REFUSED,
  functionInputIssues,
  operationConflict,
  queryInputRepair,
  reasonCode,
  schemaDataRemovalHint,
  schemaUpgradeDetails,
  schemaUpgradeHint,
} from './reasons'

/** Present one failure of a Kernel-touching command: typed for humans, one JSON line on stderr for machines. */
export async function formatKernelError(
  error: unknown,
  machine: boolean,
  urlArg = '',
  debug = false,
  options: {
    /** Members the command adds beside a Kernel refusal's `--json` document, never over its own. */
    fields?: Readonly<Record<string, unknown>>
    /** An install or uninstall: its operation, and the Execution the Kernel answered, if any. */
    lifecycle?: LifecycleContext
  } = {},
): Promise<void> {
  const { lifecycle } = options
  if (error instanceof IncompleteInstallation) {
    renderIncompleteInstallation(error, machine, lifecycle, options.fields)
    return
  }
  // A conflict over the operation is this command's refusal: it ran nothing.
  const conflict =
    error instanceof OperationConflict
      ? error
      : error instanceof ResponseError && operationConflict(error.reason)
        ? new OperationConflict(error)
        : undefined
  if (conflict !== undefined && lifecycle !== undefined) {
    renderOperationConflict(conflict, machine, lifecycle)
    if (debug) printFailureDebug(conflict.refusal, urlArg)
    return
  }
  const failure = classifyFailure(error instanceof OperationConflict ? error.refusal : error)
  // An install or uninstall says whether its operation started an Execution: a Kernel refusal
  // before any Execution answered left the operation unused.
  const notes =
    lifecycle === undefined
      ? undefined
      : lifecycleFailureNotes(lifecycle, failure.kind === 'response')
  renderFailure(failure, machine, urlArg, lifecycle?.recovery, {
    ...options.fields,
    ...notes?.fields,
  })
  if (!machine) for (const line of notes?.lines ?? []) log.dim(`  ${line}`)
  if (debug) printFailureDebug(error, urlArg)
}

/** Whether a read failed only because its Execution has not ended: there is no outcome yet. */
export function executionPending(error: unknown): boolean {
  return error instanceof ResponseError && reasonCode(error.reason) === 'EXECUTION_PENDING'
}

/**
 * Present a result read whose Execution has not ended: a neutral note, not a failure, and the
 * commands that wait for its outcome and read its status. `--json` keeps the Kernel's refusal on
 * stderr and adds `execution`, `follow` and `observe`.
 */
export async function renderPendingResult(
  error: unknown,
  pending: PendingFollowUp,
  machine: boolean,
  debug = false,
): Promise<void> {
  const { execution, follow, observe, waited } = pending
  if (machine) {
    await formatKernelError(error, true, undefined, debug, {
      fields: { execution, follow, observe },
    })
    return
  }
  log.info(
    `Execution ${execution} is still running: ${
      waited
        ? 'its outcome did not come within --wait-ms.'
        : 'it has no outcome yet, and this read did not wait (--wait-ms).'
    }`,
  )
  log.dim(`  Wait for it: ${follow}`)
  log.dim(`  Read its status: ${observe}`)
}

type FailureDiagnostic =
  | {
      readonly kind: 'simple'
      readonly code: string
      readonly message: string
      readonly hint?: string
    }
  | {
      readonly kind: 'response'
      readonly code: number
      readonly message: string
      readonly reason?: unknown
    }
  | {
      readonly kind: 'transport'
      readonly code: 'CONNECTION_ERROR' | 'DISCONNECTED' | 'TIMEOUT' | 'TRANSPORT_ERROR'
      readonly message: string
      readonly phase: TransportError['phase']
      readonly context: TransportContext
    }

export function classifyFailure(error: unknown): FailureDiagnostic {
  if (error instanceof AstraleError) return simple(error.code, error.message, error.hint)
  if (error instanceof TransportError) {
    return {
      kind: 'transport',
      code: lifecycleCode(error.phase),
      message: error.message,
      phase: error.phase,
      context: error.context,
    }
  }
  if (error instanceof ResponseError) {
    return {
      kind: 'response',
      code: error.code,
      message: error.message,
      ...(error.reason === undefined ? {} : { reason: error.reason }),
    }
  }
  if (error instanceof SessionError) return simple(lifecycleCode(error.failure), error.message)
  if (error instanceof ProtocolError) return simple('PROTOCOL_ERROR', error.message)
  if (error instanceof NodeUnavailableError)
    return simple(
      'NODE_UNAVAILABLE',
      error.message,
      'Check the instance and identity (-i/--as). Missing and inaccessible nodes have the same result; a Path also requires access to its intermediate nodes and edges.',
    )
  if (error instanceof PathError) return simple('PATH_INVALID', error.message)
  if (error instanceof AuthValueError) return simple('AUTH_VALUE_INVALID', error.message)
  if (error instanceof ClientError) return simple('CLIENT_ERROR', error.message)
  return simple('UNEXPECTED_ERROR', 'The CLI encountered an unexpected internal failure.')
}

type TransportCode = Extract<FailureDiagnostic, { kind: 'transport' }>['code']

function lifecycleCode(value: TransportError['phase']): TransportCode
function lifecycleCode(value: SessionFailure): string
function lifecycleCode(value: TransportError['phase'] | SessionFailure): string {
  if (value === 'connect') return 'CONNECTION_ERROR'
  if (value === 'timeout') return 'TIMEOUT'
  if (value === 'closed') return 'DISCONNECTED'
  return value === 'cancelled' ? 'CANCELLED' : 'TRANSPORT_ERROR'
}

const simple = (code: string, message: string, hint?: string): FailureDiagnostic => ({
  kind: 'simple',
  code,
  message,
  ...(hint === undefined ? {} : { hint }),
})

function renderFailure(
  failure: FailureDiagnostic,
  machine: boolean,
  url: string,
  recovery: OperationRecovery | undefined,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  if (failure.kind === 'transport') return renderTransport(failure, machine, url, recovery, fields)
  if (failure.kind === 'response') return renderResponse(failure, machine, fields)
  if (machine)
    return writeRaw({
      ...fields,
      error: failure.code,
      message: failure.message,
      hint: failure.hint,
    })
  log.error(`${chalk.bold(failure.code)}: ${failure.message}`)
  if (failure.hint) log.dim(`  ${failure.hint}`)
}

function renderTransport(
  failure: Extract<FailureDiagnostic, { kind: 'transport' }>,
  machine: boolean,
  url: string,
  recovery: OperationRecovery | undefined,
  fields: Readonly<Record<string, unknown>>,
): void {
  const invocation = failure.context.kind === 'invocation' ? failure.context : undefined
  // Once an Execution answered, its operation is known to have reached the Kernel.
  const unknown = invocation?.delivery === 'unknown' && typeof fields.execution !== 'string'
  if (machine) {
    writeRaw({
      ...fields,
      error: failure.code,
      message: failure.message,
      phase: failure.phase,
      transport: failure.context,
      ...(url === '' ? {} : { url }),
      ...(unknown && recovery !== undefined
        ? { operation: recovery.operation, fresh: recovery.fresh }
        : {}),
    })
    return
  }
  log.error(`${chalk.bold(failure.code)}: ${failure.message}`)
  if (url) log.dim(`  target: ${url}`)
  log.dim(`  phase: ${failure.phase}`)
  if (failure.phase === 'connect') log.dim('  Check the target and run `astrale status`.')
  else if (failure.phase === 'timeout') log.dim('  Try increasing `--timeout`.')
  else if (unknown) renderRecovery(recovery)
}

/**
 * A 2002 does not say whether the Kernel knows no Identity for this account or no longer accepts
 * its credential. A fresh sign-in renews only the credential, so it cannot help an account that was
 * never given access.
 */
const CREDENTIAL_REFUSED_HINT =
  'This Kernel does not accept this identity. If this account has no access to it, signing in again does not help: ask an administrator for an invitation. If it had access, sign in again with `astrale auth login`.'

function renderResponse(
  failure: Extract<FailureDiagnostic, { kind: 'response' }>,
  machine: boolean,
  fields: Readonly<Record<string, unknown>>,
): void {
  const code = reasonCode(failure.reason)
  const issues = functionInputIssues(failure.reason)
  const removalHint = schemaDataRemovalHint(failure.reason)
  const addressNotPublic = code === 'SCHEMA_DOMAIN_ADDRESS_NOT_PUBLIC'
  const upgrade = schemaUpgradeDetails(failure.reason)
  const message = addressNotPublic
    ? 'Expose the Domain through a public HTTPS URL or public tunnel, then retry.'
    : removalHint && !machine
      ? 'Existing business data still uses schema definitions being removed.'
      : failure.message
  const hint =
    code === 'FUNCTION_INPUT_INVALID' && (machine || issues.length === 0)
      ? 'Use `astrale introspect <path>` to see the callable input.'
      : (removalHint ??
        (upgrade
          ? schemaUpgradeHint(upgrade)
          : failure.code === CREDENTIAL_REFUSED
            ? CREDENTIAL_REFUSED_HINT
            : code === 'EXECUTION_PENDING'
              ? 'The Execution has not ended yet: wait for it with --wait-ms <milliseconds> (for example --wait-ms 20000, within --timeout), or read its status.'
              : undefined))
  if (machine) {
    writeRaw({
      ...fields,
      error: 'RESPONSE_ERROR',
      code: failure.code,
      message,
      ...(failure.reason === undefined ? {} : { reason: failure.reason }),
      ...(hint === undefined ? {} : { hint }),
    })
    return
  }
  const label = addressNotPublic
    ? 'SCHEMA_DOMAIN_ADDRESS_NOT_PUBLIC'
    : removalHint
      ? 'DATA_MIGRATION_REQUIRED'
      : `RESPONSE_ERROR(${failure.code})`
  log.error(`${chalk.bold(label)}: ${message}`)
  if (code && !addressNotPublic && !removalHint) log.dim(`  reason: ${code}`)
  for (const issue of issues)
    console.log(
      chalk.red(`  ${issue.path || '<input>'}: ${issue.message} (${chalk.dim(issue.code)})`),
    )
  const repair = queryInputRepair(failure.reason)
  if (repair?.phase === 'plan') log.dim(`  ${repair.path ?? '/'}  ${repair.issue}`)
  else if (repair?.phase === 'limit')
    log.dim(`  ${repair.path ?? '/'}  ${repair.limit} limit ${repair.actual}/${repair.maximum}`)
  else if (repair) log.dim(`  ${repair.path}  ${repair.phase} input`)
  if (upgrade?.issue === 'issuer-changed') {
    log.dim(`  installed issuer: ${upgrade.installedIssuer}`)
    log.dim(`  replacement issuer: ${upgrade.replacementIssuer}`)
    if (upgrade.consented !== undefined) {
      log.dim(`  consented: ${upgrade.consented.from} -> ${upgrade.consented.to}`)
    }
  } else if (upgrade?.issue === 'in-flight-limit') {
    log.dim(`  replaced issuers in flight: ${upgrade.inFlight}`)
  }
  if (hint) log.dim(`  ${hint}`)
}

function renderRecovery(recovery: OperationRecovery | undefined): void {
  if (!recovery)
    return log.dim('  Delivery is unknown; do not automatically retry a mutating call.')
  log.dim(
    `  Delivery is unknown: it may have reached the Kernel under operation ${recovery.operation}.`,
  )
  log.dim(
    `  Run it again with a fresh operation (the Kernel refuses it while that one runs): ${recovery.fresh}`,
  )
}

const writeRaw = (payload: Record<string, unknown>): void =>
  void process.stderr.write(`${JSON.stringify(payload)}\n`)
