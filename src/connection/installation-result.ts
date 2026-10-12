import type {
  Installation,
  InstallResult,
  SchemaApi,
  Uninstallation,
  UninstallReceipt,
} from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'
import type { NodeId } from '@astrale-os/sdk/graph/node'

import { ResponseError } from '@astrale-os/sdk/client'
import { createSchema } from '@astrale-os/sdk/client/schema'

import type { OperationRecovery } from './command'

import { shellCommand } from '../lib/shell-command'
import { log } from '../lib/terminal/log'
import { executionResultCommand, executionStatusCommand } from './execution'
import {
  conflictDetails,
  migrationRequirements,
  migrationRules,
  operationConflict,
  reasonCode,
  type MigrationRequirement,
  type MigrationRule,
  type MigrationRules,
} from './reasons'
import { resolveTimeoutMs } from './session'

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

/** How long install and uninstall wait for their outcome without --timeout. */
export const LIFECYCLE_WAIT_MS = 110_000

/**
 * How long an install or uninstall command waits for its outcome, counted from the Kernel's answer
 * naming its Execution: not at all with --no-wait, else --timeout, else {@link LIFECYCLE_WAIT_MS}.
 * Each request keeps the session's --timeout.
 */
export function lifecycleWaitMs(opts: {
  readonly timeout?: string
  readonly wait?: boolean
}): number {
  if (opts.wait === false) return 0
  return opts.timeout === undefined ? LIFECYCLE_WAIT_MS : resolveTimeoutMs(opts.timeout)
}

/**
 * The install and uninstall syscalls of one Session, which tell `started` the Execution the Kernel
 * answered as soon as it answers, with its replay marker, before the Client waits for its outcome.
 * A command interrupted while it waits, or that cannot read the outcome, still knows which
 * Execution runs; a refusal before any answer created none.
 */
export function announcingLifecycle(
  session: Pick<ClientSession, 'dispatch'>,
  started: (execution: NodeId, replayed?: boolean) => void,
): Lifecycle {
  const schema = createSchema(
    async (call, options) => {
      const result = await session.dispatch(call, options)
      if (result.kind === 'execution') started(result.execution, result.replayed)
      return result
    },
    // Only the lifecycle syscalls are exposed: the introspection limits bound nothing here.
    { maximumReleaseBytes: 1, maximumBundleBytes: 1 },
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
  readonly started?: NodeId
  /** The Kernel's `replayed` marker on that answer, as it sent it; absent when it sent none. */
  readonly replayed?: boolean
}

/**
 * The one line that says the operation's answer is the Execution it already ran, only when the
 * Kernel marked it `replayed`: its recorded outcome once `status` ended, even when its Execution
 * node was deleted since.
 */
export function replayLine(
  context: LifecycleContext,
  status?: { readonly state: string; readonly outcome?: unknown },
): string | undefined {
  const { replayed, started, recovery } = context
  if (started === undefined || replayed !== true) return undefined
  const ran = `Operation ${recovery.operation} already ran as ${started}`
  if (status?.state === 'deleted') {
    return `${ran}: its Execution was deleted; this is its recorded outcome; nothing ran again.`
  }
  const ended =
    status?.outcome !== undefined ||
    ['completed', 'failed', 'cancelled'].includes(status?.state ?? '')
  return ended
    ? `${ran}: this is its recorded outcome; nothing ran again.`
    : `Operation ${recovery.operation} already runs as ${started}: nothing started again.`
}

/** `--json`'s `replayed`: the Kernel's marker as it sent it, never inferred. */
export function replayedMember(context: LifecycleContext): { readonly replayed?: boolean } {
  return context.replayed === undefined ? {} : { replayed: context.replayed }
}

/**
 * Present an install or uninstall the operator interrupted while the command waited: the durable
 * Execution continues on the Kernel without this process. Once the Kernel answered, the output names
 * the Execution and the commands that wait for it and read it; before, only its operation is known,
 * and a fresh operation is the way to try again: the Kernel refuses it while that install runs.
 */
export function renderInterruptedWait(context: LifecycleContext, machine: boolean): void {
  const { lifecycle, recovery, started } = context
  if (machine) {
    process.stderr.write(
      `${JSON.stringify({
        error: 'INTERRUPTED',
        message:
          started === undefined
            ? `Interrupted before the Kernel answered the ${lifecycle}.`
            : `Stopped waiting; the ${lifecycle} continues on the Kernel.`,
        ...(started === undefined ? {} : { execution: started }),
        ...replayedMember(context),
        lifecycle,
        operation: recovery.operation,
        ...(started === undefined
          ? { fresh: recovery.fresh }
          : {
              observe: executionStatusCommand(started, recovery.target),
              follow: executionResultCommand(started, recovery.target),
            }),
      })}\n`,
    )
    return
  }
  if (started === undefined) {
    log.warn(
      `Interrupted before the Kernel answered: if the ${lifecycle} reached it, it runs under operation ${recovery.operation}.`,
    )
    log.dim(
      `  Run it again with a fresh operation (refused while that ${lifecycle} runs): ${recovery.fresh}`,
    )
    return
  }
  log.warn(`Stopped waiting: the ${lifecycle} continues on the Kernel as ${started}.`)
  const replayed = replayLine(context)
  if (replayed !== undefined) log.dim(`  ${replayed}`)
  log.dim(`  operation: ${recovery.operation}`)
  log.dim(`  Wait for it: ${executionResultCommand(started, recovery.target)}`)
  log.dim(`  Read this run: ${executionStatusCommand(started, recovery.target)}`)
}

/** The commands a Root maintenance session accepts while it awaits its next command. */
function sessionCommands(installation: Installation, recovery: OperationRecovery) {
  const { execution, status } = installation
  const target = recovery.target ?? []
  return {
    observe: executionStatusCommand(execution, target),
    ...(status.detail?.command === undefined
      ? {}
      : {
          apply: shellCommand(['astrale', 'domain', 'installation', 'apply', execution, ...target]),
        }),
    cancel: shellCommand(['astrale', 'execution', 'cancel', execution, ...target]),
  }
}

/**
 * The `--json` answer of an install that opened a Root maintenance session awaiting its next
 * command: its Execution and status, the operation, and the commands the session accepts.
 */
export function openSessionReport(
  installation: Installation,
  context: LifecycleContext,
): Readonly<Record<string, unknown>> {
  const { recovery } = context
  return {
    execution: installation.execution,
    lifecycle: 'install',
    status: installation.status,
    ...replayedMember(context),
    operation: recovery.operation,
    ...sessionCommands(installation, recovery),
  }
}

/**
 * Present a Root maintenance session that awaits its next command, what `install --mode
 * maintenance` asked for: its id, the command index it awaits, that the Instance is closed to other
 * callers meanwhile, and the commands it accepts.
 */
export function renderOpenSession(installation: Installation, context: LifecycleContext): void {
  const { recovery } = context
  const command = installation.status.detail?.command
  const { observe, apply, cancel } = sessionCommands(installation, recovery)
  log.success(
    `Maintenance session ${installation.execution} awaits ${command === undefined ? 'Root' : `command ${command}`} (operation ${recovery.operation})`,
  )
  const replayed = replayLine(context, installation.status)
  if (replayed !== undefined) log.dim(`  ${replayed}`)
  log.dim(
    '  The Instance is closed to other callers until the session applies its target or cancels.',
  )
  log.dim('  Repair the data as Root, then:')
  log.dim(`  Read it:  ${observe}`)
  if (apply !== undefined) log.dim(`  Apply:    ${apply}`)
  log.dim(`  Cancel:   ${cancel} (attempts to return to the source schema)`)
}

/**
 * Whether an Execution still runs as it should: not ended, not paused after its retries. The
 * command stopped waiting for it (`--no-wait`, or its deadline), which is not a failure.
 */
export function stillRunning(status: Installation['status'] | Uninstallation['status']): boolean {
  return status.outcome === undefined && status.state !== 'paused' && status.state !== 'deleted'
}

/**
 * The `--json` answer of an install or uninstall still running when the command stopped waiting:
 * its Execution and status, the operation, and the commands that follow it. No `changed`: nothing
 * is installed yet.
 */
export function runningReport(
  installation: Installation | Uninstallation,
  context: LifecycleContext,
): Readonly<Record<string, unknown>> {
  const { lifecycle, recovery } = context
  const { execution, status } = installation
  return {
    execution,
    lifecycle,
    status,
    ...replayedMember(context),
    operation: recovery.operation,
    observe: executionStatusCommand(execution, recovery.target),
    follow: executionResultCommand(execution, recovery.target),
  }
}

/**
 * Present an install or uninstall still running when the command stopped waiting, `--no-wait` or
 * its deadline: it continues on the Kernel, and the commands that follow it.
 */
export function renderRunning(
  installation: Installation | Uninstallation,
  context: LifecycleContext,
  waited: boolean,
): void {
  const { lifecycle, recovery } = context
  const { execution, status } = installation
  const name = lifecycle === 'install' ? 'Installation' : 'Uninstallation'
  log.info(
    waited
      ? `${name} ${execution} still runs on the Kernel: this command's wait (--timeout) ended first.`
      : `${name} ${execution} runs on the Kernel: --no-wait returned without waiting.`,
  )
  log.dim(
    `  execution: ${execution} (${status.state}${status.detail === undefined ? '' : `; ${status.detail.phase}`})`,
  )
  const replayed = replayLine(context, status)
  if (replayed !== undefined) log.dim(`  ${replayed}`)
  log.dim(`  operation: ${recovery.operation}`)
  log.dim(`  Wait for it: ${executionResultCommand(execution, recovery.target)}`)
  log.dim(`  Read this run: ${executionStatusCommand(execution, recovery.target)}`)
}

/** What each install class did to the stored data, as one completed install reports it. */
const CLASSES: Readonly<Record<string, string>> = {
  noop: 'nothing to change',
  immediate: 'applied at once, without reading the data',
  revalidate: 'the data was revalidated before the activation',
}

/**
 * One line naming the Execution that completed an install or uninstall and, for an install, its
 * class: `noop`, `immediate` or `revalidate`, with the pages a revalidation read.
 */
export function completedExecutionLine(installation: Installation | Uninstallation): string {
  const detail = installation.status.detail
  const meaning = detail?.class === undefined ? undefined : CLASSES[detail.class]
  const pages =
    detail?.class === 'revalidate' && detail.progress !== undefined
      ? `, ${detail.progress.pages} ${detail.progress.pages === 1 ? 'page' : 'pages'}`
      : ''
  return detail?.class === undefined
    ? `execution: ${installation.execution}`
    : `execution: ${installation.execution} (${detail.class}: ${meaning ?? detail.class}${pages})`
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
  const observe = executionStatusCommand(execution, recovery?.target)
  const ended = outcome !== undefined
  const fresh = ended ? recovery?.fresh : undefined
  const replayed = context === undefined ? undefined : replayLine(context, status)
  if (machine) {
    process.stderr.write(
      `${JSON.stringify({
        ...fields,
        error: code,
        message,
        execution,
        lifecycle: error.kind,
        status,
        ...(context === undefined ? {} : replayedMember(context)),
        ...(recovery === undefined ? {} : { operation: recovery.operation, observe }),
        ...(fresh === undefined ? {} : { fresh }),
      })}\n`,
    )
    return
  }
  // A replayed end is the one recorded when the operation ran: the data may have changed since.
  const explained =
    failure === undefined
      ? undefined
      : explainFailure(error.kind, failure, recovery?.fresh, replayed !== undefined)
  log.error(`${code}: ${explained?.message ?? message}`)
  for (const line of explained?.lines ?? []) log.dim(`  ${line}`)
  if (replayed !== undefined) log.dim(`  ${replayed}`)
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
  if (recovery !== undefined && replayed === undefined) {
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
  const execution = named.execution as NodeId
  const read = async (reads: {
    readonly status: (execution: NodeId) => Promise<{ readonly state: string }>
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
    other === undefined ? undefined : executionStatusCommand(other.execution, recovery.target)
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
    const observe = executionStatusCommand(started, recovery.target)
    const follow = executionResultCommand(started, recovery.target)
    return {
      fields: {
        execution: started,
        lifecycle,
        ...replayedMember(context),
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

/** A failure in the reader's terms: a headline replacing the Kernel's message, and what to do. */
interface ExplainedFailure {
  readonly message: string
  readonly lines: readonly string[]
}

/**
 * A failure in the reader's terms. A `recorded` one is a replayed end: it tells, in the past
 * tense, what the data was when the operation ran.
 */
function explainFailure(
  lifecycle: 'install' | 'uninstall',
  failure: { readonly code: string; readonly details?: unknown },
  fresh: string | undefined,
  recorded: boolean,
): ExplainedFailure | undefined {
  if (failure.code !== 'DATA_MIGRATION_REQUIRED') return undefined
  const requirements = migrationRequirements(failure.details)
  return lifecycle === 'uninstall'
    ? uninstallDataRemains(requirements, recorded)
    : installDataInvalid(migrationRules(failure.details), requirements, fresh, recorded)
}

/** Rules, and offenders of each, a human reads before the status shows them all. */
const SHOWN_RULES = 5
const SHOWN_OFFENDERS = 3

/**
 * An install refused because the stored data breaks rules of its target schema: which rules, how
 * many facts or values break each, the first of them, and the two ways forward: repair the data
 * and install again, or repair it in a Root maintenance session. Its headline replaces the
 * Kernel's message, which says the same less precisely; `--json` keeps that message.
 */
function installDataInvalid(
  { rules, truncated }: MigrationRules,
  requirements: readonly MigrationRequirement[],
  fresh: string | undefined,
  recorded: boolean,
): ExplainedFailure | undefined {
  let message: string
  const lines: string[] = []
  if (rules.length > 0) {
    const count = `${rules.length}${truncated ? ' or more' : ''}`
    const noun = rules.length === 1 && !truncated ? 'rule' : 'rules'
    message = recorded
      ? `When it ran, the stored data broke ${count} ${noun} of the new schema:`
      : `The stored data breaks ${count} ${noun} of the new schema:`
    for (const rule of rules.slice(0, SHOWN_RULES)) lines.push(`  ${ruleLine(rule, recorded)}`)
    if (rules.length > SHOWN_RULES || truncated) {
      lines.push('  and more: the status of the run below lists every rule.')
    }
  } else if (requirements.length > 0) {
    message = recorded
      ? 'When it ran, the stored data had to be migrated before the new schema could activate:'
      : 'The stored data must be migrated before the new schema activates:'
    for (const requirement of requirements) {
      lines.push(
        `  ${requirement.subject}: ${requirement.operation} (${requirement.reason})` +
          (requirement.work.observedFacts === undefined
            ? ''
            : `, ${requirement.work.observedFacts} ${requirement.work.observedFacts === 1 ? 'fact' : 'facts'}`),
      )
    }
  } else {
    return undefined
  }
  lines.push(
    recorded
      ? 'Repair what still breaks them, then install again with a fresh operation.'
      : 'Repair that data, then install again with a fresh operation.',
  )
  if (fresh !== undefined && !fresh.includes('--mode')) {
    lines.push(
      `Or repair it in a Root maintenance session, the Instance closed meanwhile: ${fresh} --mode maintenance`,
    )
  }
  return { message, lines }
}

/**
 * One rule: what it requires, how much data breaks it, and the first offenders; as `recorded`
 * when the operation ran, in the past tense.
 */
function ruleLine(rule: MigrationRule, recorded: boolean): string {
  const was = recorded ? 'was ' : ''
  if (rule.verdict === 'undecided') {
    return `${rule.rule}: ${rule.family} rule ${was}not decided${rule.undecided === undefined ? '' : ` (${rule.undecided})`}`
  }
  const count =
    rule.count === undefined
      ? undefined
      : `${rule.count.bound === 'atLeast' ? 'at least ' : ''}${rule.count.value} ${
          rule.count.unit === 'facts'
            ? rule.count.value === 1
              ? 'fact'
              : 'facts'
            : rule.count.value === 1
              ? 'value'
              : 'values'
        }`
  const were = recorded ? (rule.count?.value === 1 ? 'was ' : 'were ') : ''
  const broken =
    rule.family === 'required'
      ? `required, ${was}missing on ${count ?? 'some facts'}`
      : rule.family === 'value'
        ? `${count ?? 'some values'} ${were}not allowed`
        : `${rule.family} rule ${was}broken by ${count ?? 'some facts'}`
  const shown = rule.offenders.slice(0, SHOWN_OFFENDERS)
  const more =
    rule.count?.bound === 'exact' && rule.count.value > shown.length
      ? ` and ${rule.count.value - shown.length} more`
      : rule.truncated || rule.offenders.length > shown.length
        ? ' and more'
        : ''
  return `${rule.rule}: ${broken}${shown.length === 0 ? '' : `: ${shown.join(', ')}${more}`}`
}

/**
 * An uninstall refused because data typed by its Domains remains: how much of which Class, and
 * what removes it. A safe uninstall never deletes data, and even `--destructive` deletes at most
 * a bound of each Class. Above that bound the Kernel stops counting, so its count is a lower
 * bound, and the one remedy that works is to bring each such Class under it first.
 */
function uninstallDataRemains(
  requirements: readonly MigrationRequirement[],
  recorded: boolean,
): ExplainedFailure | undefined {
  const removals = requirements.filter(({ operation }) => operation === 'remove-facts')
  if (removals.length === 0) return undefined
  const lines = removals.map(
    (requirement) => `${requirement.subject}: ${remaining(requirement, recorded)}`,
  )
  const references = removals.some(({ reason }) => reason === 'foreign-reference')
    ? [
        `Data of other Domains ${recorded ? 'referenced' : 'references'} it: delete those references first.`,
      ]
    : []
  const limit = removals
    .filter(({ reason }) => reason !== 'foreign-reference')
    .map(({ work }) => bound(work))
    .find((value) => value !== undefined)
  if (limit !== undefined) {
    return {
      message: recorded
        ? 'When it ran, more data of the Domains to uninstall remained than one uninstall deletes.'
        : 'More data of the Domains to uninstall remains than one uninstall deletes.',
      lines: [
        ...lines,
        ...references,
        `Delete facts of each such Class until at most ${limit} of it remain, then uninstall again (with --destructive to delete the rest with the Domains).`,
      ],
    }
  }
  return {
    message: recorded
      ? 'When it ran, data of the Domains to uninstall remained.'
      : 'Data of the Domains to uninstall remains.',
    lines: [
      ...lines,
      ...references,
      ...(removals.some(({ reason }) => reason === 'destructive-change')
        ? [
            'A safe uninstall never deletes data: delete it, or uninstall with --destructive to delete it with the Domains.',
          ]
        : []),
    ],
  }
}

/**
 * The bound one uninstall deletes of one Class, present only on a requirement above it, whose
 * counts are then lower bounds.
 */
function bound(work: MigrationRequirement['work']): string | undefined {
  const parts = [
    ...(work.maximumFacts === undefined ? [] : [facts(work.maximumFacts)]),
    ...(work.maximumBytes === undefined ? [] : [`${work.maximumBytes} bytes`]),
  ]
  return parts.length === 0 ? undefined : parts.join(' and ')
}

function facts(count: number): string {
  return `${count} ${count === 1 ? 'fact' : 'facts'}`
}

/**
 * How much of one subject remains, or remained when the operation ran (`recorded`): "at least"
 * once the Kernel stopped counting at the bound.
 */
function remaining({ reason, work }: MigrationRequirement, recorded: boolean): string {
  const above = bound(work) !== undefined
  const bytes =
    above &&
    work.observedBytes !== undefined &&
    work.maximumBytes !== undefined &&
    work.observedBytes > work.maximumBytes
      ? ` (at least ${work.observedBytes} bytes)`
      : ''
  const count =
    work.observedFacts === undefined
      ? 'data'
      : `${above ? 'at least ' : ''}${facts(work.observedFacts)}${bytes}`
  if (reason === 'foreign-reference') return `${count} referenced by data of other Domains.`
  const one = work.observedFacts === undefined || work.observedFacts === 1
  return `${count} ${recorded ? 'remained' : one ? 'remains' : 'remain'}.`
}
