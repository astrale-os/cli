import type {
  InstallExecutionId,
  Installation,
  InstallResult,
  SchemaApi,
  Uninstallation,
  UninstallReceipt,
} from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'

import { ResponseError } from '@astrale-os/sdk/client'
import { createSchema, DEFAULT_SCHEMA_LIFECYCLE_TIMEOUT_MS } from '@astrale-os/sdk/client/schema'

import type { OperationRecovery } from './command'

import { shellCommand } from '../lib/shell-command'
import { log } from '../lib/terminal/log'
import { conflictDetails, operationConflict, reasonCode } from './reasons'

/** A successful call can still describe an unfinished or rejected installation. */
export class IncompleteInstallation extends Error {
  constructor(
    readonly installation: Installation | Uninstallation,
    readonly kind: 'install' | 'uninstall' = 'install',
  ) {
    super(`Installation ${installation.execution} is ${installation.status.state}.`)
  }
}

/**
 * Exit status of a Kernel command that failed: 2 when its durable install or uninstall Execution
 * ended `failed` (the Kernel refused it inside its run, and its error and report say why), 5 when
 * the Kernel refused it as a conflict over its operation or while another schema change holds the
 * Instance (the client spec's conflict code), else 1.
 */
export function failureExitCode(error: unknown): 1 | 2 | 5 {
  if (
    error instanceof OperationConflict ||
    (error instanceof ResponseError && reasonCode(error.reason) === 'SCHEMA_CHANGE_ACTIVE')
  ) {
    return 5
  }
  return error instanceof IncompleteInstallation &&
    error.installation.status.outcome?.kind === 'failed'
    ? 2
    : 1
}

export function installationResult(installation: Installation): InstallResult
export function installationResult(
  installation: Uninstallation,
  kind: 'uninstall',
): UninstallReceipt
export function installationResult(
  installation: Installation | Uninstallation,
  kind: 'install' | 'uninstall' = 'install',
): InstallResult | UninstallReceipt {
  if (installation.status.outcome?.kind !== 'completed' || installation.result === undefined) {
    throw new IncompleteInstallation(installation, kind)
  }
  return installation.result
}

/** The install and uninstall syscalls, as `announcingLifecycle` binds them. */
export type Lifecycle = Pick<SchemaApi, 'install' | 'uninstall'>

/**
 * The install and uninstall syscalls of one Session, which tell `started` the Execution the Kernel
 * answered as soon as it answers, before the Client waits for its outcome. A command interrupted
 * while it waits, or that cannot read the outcome, still knows which Execution runs; a refusal
 * before any answer created none.
 */
export function announcingLifecycle(
  session: Pick<ClientSession, 'dispatch'>,
  started: (execution: InstallExecutionId) => void,
): Lifecycle {
  const schema = createSchema(
    async (call, options) => {
      const result = await session.dispatch(call, options)
      if (result.kind === 'execution') started(result.execution)
      return result
    },
    // Only the lifecycle syscalls are exposed: the introspection limits bound nothing here.
    {
      maximumReleaseBytes: 1,
      maximumBundleBytes: 1,
      lifecycleTimeoutMs: DEFAULT_SCHEMA_LIFECYCLE_TIMEOUT_MS,
    },
  )
  return Object.freeze({
    install: (request, options) => schema.install(request, options),
    uninstall: (request, options) => schema.uninstall(request, options),
  })
}

/** What an install or uninstall command knows of its operation beside how it ended. */
export interface LifecycleContext {
  readonly lifecycle: 'install' | 'uninstall'
  readonly recovery: OperationRecovery
  /** The Execution the Kernel answered for the operation; absent when it never answered one. */
  readonly started?: InstallExecutionId
}

/** The command that reads one install or uninstall Execution, on the same Instance and identity. */
export function installationStatusCommand(
  execution: string,
  lifecycle: 'install' | 'uninstall',
  target: readonly string[] = [],
): string {
  return shellCommand([
    'astrale',
    'domain',
    'installation',
    'status',
    execution,
    ...(lifecycle === 'uninstall' ? ['--uninstall'] : []),
    ...target,
  ])
}

/** How long the printed follow-up waits for the outcome: within the default request timeout. */
const FOLLOW_WAIT_MS = 20_000

/** The command that waits for one install or uninstall Execution's outcome. */
export function installationResultCommand(
  execution: string,
  lifecycle: 'install' | 'uninstall',
  target: readonly string[] = [],
): string {
  return shellCommand([
    'astrale',
    'domain',
    'installation',
    'result',
    execution,
    ...(lifecycle === 'uninstall' ? ['--uninstall'] : []),
    '--wait-ms',
    String(FOLLOW_WAIT_MS),
    ...target,
  ])
}

const DONE = { install: 'installed', uninstall: 'uninstalled' } as const

/**
 * Present an install or uninstall that ended without a result, from its admitted Execution status:
 * what happened, whether its operation is used, and what to run next. An Execution that ended
 * (failed or cancelled) used its operation for good, so a new attempt needs a fresh operation.
 * `--json` keeps the status and the operation, and adds `observe`, and `fresh` once it ended.
 */
export function renderIncompleteInstallation(
  error: IncompleteInstallation,
  machine: boolean,
  context?: LifecycleContext,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  const { execution, status } = error.installation
  const outcome = status.outcome
  const failure = outcome?.kind === 'failed' ? outcome.error : undefined
  const code =
    failure?.code ??
    (outcome?.kind === 'cancelled' ? 'INSTALLATION_CANCELLED' : 'INSTALLATION_PENDING')
  const message = failure?.message ?? error.message
  const recovery = context?.recovery
  const observe = installationStatusCommand(execution, error.kind, recovery?.target)
  const ended = outcome !== undefined
  const fresh = ended ? recovery?.fresh : undefined
  if (machine) {
    process.stderr.write(
      `${JSON.stringify({
        ...fields,
        error: code,
        message,
        execution,
        lifecycle: error.kind,
        status,
        ...(recovery === undefined ? {} : { operation: recovery.operation, observe }),
        ...(fresh === undefined ? {} : { fresh }),
      })}\n`,
    )
    return
  }
  log.error(`${code}: ${message}`)
  if (outcome?.kind === 'failed') {
    log.dim(`  The ${error.kind} ran and was refused: nothing was ${DONE[error.kind]}.`)
  } else if (outcome?.kind === 'cancelled') {
    log.dim(`  The ${error.kind} was cancelled: nothing was ${DONE[error.kind]}.`)
  }
  log.dim(
    `  execution: ${execution} (${status.state}${status.detail === undefined ? '' : `; ${status.detail.phase}`})`,
  )
  if (status.detail?.phase === 'awaiting') {
    log.dim(
      `  Repair session is waiting for command:${status.detail.command}. Read its status before applying or cancelling.`,
    )
  }
  if (recovery !== undefined) {
    log.dim(
      ended
        ? `  operation: ${recovery.operation} is used: this ${outcome.kind === 'failed' ? 'failure' : 'cancellation'} is its final outcome.`
        : `  operation: ${recovery.operation}`,
    )
  }
  log.dim(`  Read this run: ${observe}`)
  if (fresh !== undefined) log.dim(`  Try again with a fresh operation: ${fresh}`)
}

/** The request an operation conflict names, as far as this command could read its Execution. */
export interface ConflictingRequest {
  readonly execution: string
  readonly lifecycle?: 'install' | 'uninstall'
  /** The mode an install was requested in. */
  readonly mode?: string
  readonly state?: string
}

/**
 * An install or uninstall the Kernel refused because its operation id already names another
 * request of its principal: a refusal of this command, which ran nothing. `other` is that request,
 * when the Kernel named its Execution.
 */
export class OperationConflict extends Error {
  constructor(
    readonly refusal: ResponseError,
    readonly other?: ConflictingRequest,
  ) {
    super(refusal.message)
  }
}

/**
 * The failure an install or uninstall call ended with, an operation conflict made an
 * {@link OperationConflict} that reads the Execution it names: an install names its mode, an
 * uninstall none, unless its node was deleted. Any other failure is returned as it is.
 */
export async function conflictFailure(
  error: unknown,
  schema: Pick<SchemaApi, 'installation' | 'uninstallation'>,
): Promise<unknown> {
  if (!(error instanceof ResponseError) || !operationConflict(error.reason)) return error
  const named = conflictDetails(error.reason)
  if (named.execution === undefined) return new OperationConflict(error)
  const execution = named.execution as InstallExecutionId
  const read = async (reads: {
    readonly status: (execution: InstallExecutionId) => Promise<{ readonly state: string }>
  }) => {
    try {
      return (await reads.status(execution)).state
    } catch {
      return undefined
    }
  }
  if (named.mode !== undefined) {
    const state = await read(schema.installation)
    return new OperationConflict(error, {
      execution,
      lifecycle: 'install',
      mode: named.mode,
      ...(state === undefined ? {} : { state }),
    })
  }
  const state = (await read(schema.uninstallation)) ?? (await read(schema.installation))
  return new OperationConflict(error, {
    execution,
    ...(state === undefined || state === 'deleted' ? {} : { lifecycle: 'uninstall' as const }),
    ...(state === undefined ? {} : { state }),
  })
}

/** One request an operation names: its Execution, then what it is and how it stands, when known. */
function requestLabel({ execution, lifecycle, mode, state }: ConflictingRequest): string {
  const kind = mode === undefined ? lifecycle : `${mode} install`
  const known = [kind, state].filter((part) => part !== undefined)
  return known.length === 0 ? execution : `${execution} (${known.join(', ')})`
}

/**
 * Present an operation conflict as the refusal of this command: which request the operation
 * already names and how it stands, that nothing ran, and the two ways on: read that request's run,
 * or run this command with a fresh operation. `--json` keeps the Kernel refusal and adds
 * `conflict`, `observe` and `fresh`.
 */
export function renderOperationConflict(
  error: OperationConflict,
  machine: boolean,
  context: LifecycleContext,
): void {
  const { lifecycle, recovery } = context
  const { other, refusal } = error
  const code = reasonCode(refusal.reason) ?? 'SCHEMA_OPERATION_CONFLICT'
  const named = other === undefined ? '' : `: ${requestLabel(other)}`
  const message = `Operation ${recovery.operation} already names another request${named}. Nothing ran for this command.`
  const observe =
    other === undefined
      ? undefined
      : installationStatusCommand(other.execution, other.lifecycle ?? 'install', recovery.target)
  if (machine) {
    process.stderr.write(
      `${JSON.stringify({
        error: 'RESPONSE_ERROR',
        code: refusal.code,
        message: refusal.message,
        reason: refusal.reason,
        hint: message,
        lifecycle,
        operation: recovery.operation,
        ...(other === undefined ? {} : { conflict: other, observe }),
        fresh: recovery.fresh,
      })}\n`,
    )
    return
  }
  log.error(`${code}: ${message}`)
  if (observe !== undefined) log.dim(`  Read that request's run: ${observe}`)
  log.dim(`  Run this ${lifecycle} with a fresh operation: ${recovery.fresh}`)
}

/**
 * The lines a human reads, and the members `--json` adds, after an install or uninstall failed
 * other than by its Execution's outcome: refused before any Execution existed (nothing started, the
 * operation unused), or started and then unreadable (it continues on the Kernel).
 */
export function lifecycleFailureNotes(
  context: LifecycleContext,
  refusedAtDispatch: boolean,
): {
  readonly hint?: string
  readonly fields: Readonly<Record<string, unknown>>
  readonly lines: readonly string[]
} {
  const { lifecycle, recovery, started } = context
  if (started !== undefined) {
    const observe = installationStatusCommand(started, lifecycle, recovery.target)
    const follow = installationResultCommand(started, lifecycle, recovery.target)
    return {
      fields: {
        execution: started,
        lifecycle,
        operation: recovery.operation,
        observe,
        follow,
      },
      lines: [
        `The ${lifecycle} started as ${started} and continues on the Kernel; this command could not read how it ends.`,
        `operation: ${recovery.operation}`,
        `Wait for it: ${follow}`,
        `Read this run: ${observe}`,
      ],
    }
  }
  if (!refusedAtDispatch) return { fields: {}, lines: [] }
  return {
    fields: { execution: null, lifecycle, operation: recovery.operation, fresh: recovery.fresh },
    lines: [
      `Not started: the Kernel refused this ${lifecycle} before creating an Execution, so operation ${recovery.operation} was not used.`,
      `Run it again once that is resolved: ${recovery.fresh}`,
    ],
  }
}
