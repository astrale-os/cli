import chalk from 'chalk'

import type { OperationRecovery } from './command'

import { AstraleError } from '../errors'
import { readLocalStatus, type LocalStatus } from '../lib/local-status'
import { log } from '../lib/log'
import {
  functionInputIssues,
  queryInputRepair,
  reasonCode,
  schemaUpgradeDetails,
  schemaUpgradeHint,
  type FunctionInputIssue,
  type QueryInputRepair,
} from './reasons'

export { functionInputIssues, schemaUpgradeHint } from './reasons'

/**
 * Format and display a kernel client error.
 *
 * Handles CLI-local errors plus the current Kernel Client public error families.
 *
 * When `debug` is true, additional diagnostic information (class name, full
 * error chain, attached url/details) is printed after the user-facing line.
 */
export async function formatKernelError(
  error: unknown,
  isRaw: boolean,
  urlArg = '',
  debug = false,
  opts: { recovery?: OperationRecovery } = {},
): Promise<void> {
  const url =
    urlArg || (error instanceof Error ? ((error as Error & { url?: string }).url ?? '') : '')
  const localContext = await contextForError(error)
  // Handle AstraleError (AuthError, etc.) with structured hints
  if (error instanceof AstraleError) {
    if (isRaw) {
      writeRaw({ error: error.code, message: error.message, hint: error.hint })
    } else {
      log.error(`${chalk.bold(error.code)}: ${error.message}`)
      if (error.hint) log.dim(`  ${error.hint}`)
    }
    if (debug) printDebug(error, url)
    return
  }

  if (!(error instanceof Error)) {
    if (isRaw) writeRaw({ error: 'UNKNOWN', message: String(error) })
    else log.error(String(error))
    return
  }

  const name = error.name

  switch (name) {
    case 'TransportError':
      presentTransportError(error, isRaw, url, localContext, opts.recovery)
      break

    case 'ResponseError': {
      const code = (error as { readonly code?: unknown }).code
      const reason = (error as { readonly reason?: unknown }).reason
      const codeOfReason = reasonCode(reason)
      const inputIssues = functionInputIssues(reason)
      const queryRepair = queryInputRepair(reason)
      const upgrade = schemaUpgradeDetails(reason)
      const removalHint = schemaDataRemovalHint(reason)
      const domainAddressNotPublic = codeOfReason === 'SCHEMA_DOMAIN_ADDRESS_NOT_PUBLIC'
      const displayMessage = domainAddressNotPublic
        ? 'Expose the Domain through a public HTTPS URL or public tunnel, then retry.'
        : removalHint !== undefined && !isRaw
          ? 'Existing business data still uses schema definitions being removed.'
          : error.message
      const hint =
        codeOfReason === 'FUNCTION_INPUT_INVALID' && (isRaw || inputIssues.length === 0)
          ? 'Use `astrale introspect <path>` to see the callable input.'
          : (removalHint ?? (upgrade === undefined ? undefined : schemaUpgradeHint(upgrade)))
      if (isRaw) {
        writeRaw({
          error: 'RESPONSE_ERROR',
          ...(code === undefined ? {} : { code }),
          message: displayMessage,
          ...(reason === undefined ? {} : { reason }),
          ...(hint === undefined ? {} : { hint }),
        })
      } else {
        log.error(
          domainAddressNotPublic
            ? `${chalk.bold('SCHEMA_DOMAIN_ADDRESS_NOT_PUBLIC')}: ${displayMessage}`
            : removalHint !== undefined
              ? `${chalk.bold('DATA_MIGRATION_REQUIRED')}: ${displayMessage}`
              : `${chalk.bold(code === undefined ? 'RESPONSE_ERROR' : `RESPONSE_ERROR(${String(code)})`)}: ${displayMessage}`,
        )
        if (codeOfReason !== undefined && !domainAddressNotPublic && removalHint === undefined) {
          log.dim(`  reason: ${codeOfReason}`)
        }
        presentFunctionInputIssues(inputIssues)
        if (queryRepair !== undefined) presentQueryInputRepair(queryRepair)
        if (upgrade?.expected !== undefined) {
          log.dim(`  installed issuer: ${upgrade.expected}`)
        }
        if (upgrade?.actual !== undefined) {
          log.dim(`  replacement issuer: ${upgrade.actual}`)
        }
        if (hint !== undefined) log.dim(`  ${hint}`)
      }
      break
    }

    default: {
      const mapped = mapPublicError(error)
      if (isRaw) {
        writeRaw({
          error: mapped.code,
          message: mapped.message,
          ...(mapped.hint === undefined ? {} : { hint: mapped.hint }),
          ...(mapped.timeoutMs === undefined ? {} : { timeoutMs: mapped.timeoutMs }),
        })
      } else {
        log.error(`${chalk.bold(mapped.code)}: ${mapped.message}`)
        if (mapped.hint) log.dim(`  ${mapped.hint}`)
      }
    }
  }

  if (debug) printDebug(error, url)
}

function schemaDataRemovalHint(reason: unknown): string | undefined {
  if (reason === null || typeof reason !== 'object') return undefined
  const value = reason as { readonly code?: unknown; readonly details?: unknown }
  if (value.code !== 'DATA_MIGRATION_REQUIRED') return undefined
  if (value.details === null || typeof value.details !== 'object') return undefined

  const requirements = (value.details as { readonly requirements?: unknown }).requirements
  if (
    !Array.isArray(requirements) ||
    requirements.length === 0 ||
    !requirements.every(
      (requirement) =>
        requirement !== null &&
        typeof requirement === 'object' &&
        (requirement as { readonly operation?: unknown }).operation === 'remove-facts' &&
        (requirement as { readonly reason?: unknown }).reason === 'destructive-change',
    )
  ) {
    return undefined
  }

  return 'Delete this data explicitly, then retry. No data was deleted.'
}

function mapPublicError(error: Error): {
  code: string
  message: string
  hint?: string
  timeoutMs?: number
} {
  const name = error.name
  if (name === 'PathError') {
    return { code: 'PATH_INVALID', message: error.message }
  }
  if (name === 'NodeUnavailableError') {
    return {
      code: 'NODE_UNAVAILABLE',
      message: error.message,
      hint: 'If this is a callable Path, use `astrale call` or `astrale introspect`.',
    }
  }
  if (name === 'AuthValueError') {
    return { code: 'AUTH_VALUE_INVALID', message: error.message }
  }
  if (name === 'ClientError' && /timed out/i.test(error.message)) {
    const timeoutMs = (error as { timeoutMs?: number }).timeoutMs
    return {
      code: 'TIMEOUT',
      message: error.message,
      hint: 'Try increasing with --timeout',
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }
  }
  if (name === 'ClientError' && /Publication discovery returned HTTP/i.test(error.message)) {
    return {
      code: 'KERNEL_DISCOVERY_FAILED',
      message: error.message,
      hint: 'Pass the Kernel issuer URL (no /invoke suffix), e.g. https://host/kernel/host',
    }
  }
  return { code: name && name !== 'Error' ? name : 'UNKNOWN', message: error.message }
}

function presentTransportError(
  error: Error,
  isRaw: boolean,
  url: string,
  context: LocalStatus | undefined,
  recovery: OperationRecovery | undefined,
): void {
  const phase = transportPhase(error)
  const delivery = transportDelivery(error)
  const code =
    phase === 'connect'
      ? 'CONNECTION_ERROR'
      : phase === 'timeout'
        ? 'TIMEOUT'
        : phase === 'closed'
          ? 'DISCONNECTED'
          : 'TRANSPORT_ERROR'
  if (isRaw) {
    writeRaw({
      error: code,
      message: error.message,
      ...(url === '' ? {} : { url }),
      ...(phase === undefined ? {} : { phase }),
      ...(delivery === undefined ? {} : { delivery }),
      ...(context === undefined ? {} : { context }),
      ...(delivery === 'unknown' && recovery !== undefined ? recovery : {}),
    })
    return
  }
  log.error(`${chalk.bold(code)}: ${error.message}`)
  if (url !== '') log.dim(`  target: ${url}`)
  if (phase !== undefined) log.dim(`  phase: ${phase}`)
  if (phase === 'connect') log.dim('  Check the target and run `astrale status`.')
  else if (phase === 'timeout') log.dim('  Try increasing `--timeout`.')
  else if (delivery === 'unknown') printOperationRecovery(recovery)
  printLocalContext(context)
}

function printOperationRecovery(recovery: OperationRecovery | undefined): void {
  if (recovery === undefined) {
    log.dim('  Delivery is unknown; do not automatically retry a mutating call.')
    return
  }
  log.dim('  Delivery is unknown; retry with the same operation id:')
  log.dim(`  operation: ${recovery.operation}`)
  log.dim(`  ${recovery.retry}`)
}

function presentFunctionInputIssues(issues: readonly FunctionInputIssue[]): void {
  for (const issue of issues) {
    const location = issue.path === undefined || issue.path === '' ? '<input>' : issue.path
    console.log(chalk.red(`  ${location}: ${issue.message} (${chalk.dim(issue.code)})`))
  }
}

function presentQueryInputRepair(repair: QueryInputRepair): void {
  if (repair.phase === 'plan') {
    log.dim(`  ${repair.path ?? '/'}  ${repair.issue}`)
    return
  }
  if (repair.phase === 'limit') {
    log.dim(`  ${repair.path ?? '/'}  ${repair.limit} limit ${repair.actual}/${repair.maximum}`)
    return
  }
  log.dim(`  ${repair.path}  ${repair.phase} input`)
}

function transportPhase(error: Error): string | undefined {
  const phase = (error as Error & { readonly phase?: unknown }).phase
  return phase === 'connect' ||
    phase === 'send' ||
    phase === 'receive' ||
    phase === 'timeout' ||
    phase === 'closed'
    ? phase
    : undefined
}

function transportDelivery(error: Error): string | undefined {
  const delivery = (error as Error & { readonly delivery?: unknown }).delivery
  return delivery === 'not-sent' || delivery === 'unknown' ? delivery : undefined
}

function writeRaw(payload: Record<string, unknown>): void {
  process.stderr.write(JSON.stringify(payload) + '\n')
}

async function contextForError(error: unknown): Promise<LocalStatus | undefined> {
  if (!(error instanceof Error)) return undefined
  if (error.name !== 'TransportError') return undefined
  return readLocalStatus().catch(() => undefined)
}

function printLocalContext(context: LocalStatus | undefined): void {
  if (!context) return
  process.stderr.write(chalk.dim('\nContext:\n'))
  if ('error' in context.admin) {
    process.stderr.write(chalk.dim(`  admin: invalid (${context.admin.error})\n`))
  } else {
    process.stderr.write(chalk.dim(`  admin: ${context.admin.name} -> ${context.admin.url}\n`))
  }
  if (context.instance) {
    process.stderr.write(
      chalk.dim(`  instance: ${context.instance.active} -> ${context.instance.url}\n`),
    )
  } else {
    process.stderr.write(chalk.dim('  instance: none\n'))
  }
  if (context.identity) {
    const source =
      context.identity.source === 'idp'
        ? `idp:${context.identity.idp ?? 'unknown'}`
        : context.identity.source
    process.stderr.write(chalk.dim(`  identity: ${context.identity.name} [${source}]\n`))
    if (context.identity.session?.cached) {
      const state = context.identity.session.requiresLogin ? 'login required' : 'ready'
      process.stderr.write(chalk.dim(`  session: ${state}\n`))
    } else if (context.identity.source === 'idp') {
      process.stderr.write(chalk.dim('  session: not cached\n'))
    }
  } else {
    process.stderr.write(chalk.dim('  identity: none\n'))
  }
}

function printDebug(error: unknown, url: string): void {
  process.stderr.write('\n' + chalk.dim('── debug ─────────────────') + '\n')
  if (url) process.stderr.write(chalk.dim(`url:   ${url}`) + '\n')
  if (error instanceof Error) {
    process.stderr.write(chalk.dim(`class: ${error.constructor.name}`) + '\n')
    if (error.stack) process.stderr.write(chalk.dim(error.stack) + '\n')
    // Walk cause chain
    let cause = (error as Error & { cause?: unknown }).cause
    while (cause instanceof Error) {
      process.stderr.write(
        chalk.dim(`caused by: ${cause.constructor.name}: ${cause.message}`) + '\n',
      )
      if (cause.stack) process.stderr.write(chalk.dim(cause.stack) + '\n')
      cause = (cause as Error & { cause?: unknown }).cause
    }
    // Any attached fields (code, details, etc.)
    const extras: Record<string, unknown> = {}
    const bag = error as unknown as Record<string, unknown>
    for (const key of [
      'code',
      'type',
      'reason',
      'details',
      'errors',
      'data',
      'timeoutMs',
      'requestId',
    ]) {
      const v = bag[key]
      if (v !== undefined) extras[key] = v
    }
    if (Object.keys(extras).length > 0) {
      process.stderr.write(chalk.dim(`extras: ${JSON.stringify(extras, null, 2)}`) + '\n')
    }
  } else {
    process.stderr.write(chalk.dim(String(error)) + '\n')
  }
}
