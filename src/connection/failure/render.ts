import chalk from 'chalk'

import type { OperationRecovery } from '../command'
import type { FailureDiagnostic } from './model'

import { log } from '../../lib/log'
import {
  functionInputIssues,
  queryInputRepair,
  reasonCode,
  schemaDataRemovalHint,
  schemaUpgradeDetails,
  schemaUpgradeHint,
} from '../reasons'

export function renderFailure(
  failure: FailureDiagnostic,
  machine: boolean,
  url: string,
  recovery: OperationRecovery | undefined,
): void {
  if (failure.kind === 'transport') return renderTransport(failure, machine, url, recovery)
  if (failure.kind === 'response') return renderResponse(failure, machine)
  if (machine)
    return writeRaw({ error: failure.code, message: failure.message, hint: failure.hint })
  log.error(`${chalk.bold(failure.code)}: ${failure.message}`)
  if (failure.hint) log.dim(`  ${failure.hint}`)
}

function renderTransport(
  failure: Extract<FailureDiagnostic, { kind: 'transport' }>,
  machine: boolean,
  url: string,
  recovery: OperationRecovery | undefined,
): void {
  const invocation = failure.context.kind === 'invocation' ? failure.context : undefined
  if (machine) {
    writeRaw({
      error: failure.code,
      message: failure.message,
      phase: failure.phase,
      transport: failure.context,
      ...(url === '' ? {} : { url }),
      ...(invocation?.delivery === 'unknown' && recovery !== undefined ? recovery : {}),
    })
    return
  }
  log.error(`${chalk.bold(failure.code)}: ${failure.message}`)
  if (url) log.dim(`  target: ${url}`)
  log.dim(`  phase: ${failure.phase}`)
  if (failure.phase === 'connect') log.dim('  Check the target and run `astrale status`.')
  else if (failure.phase === 'timeout') log.dim('  Try increasing `--timeout`.')
  else if (invocation?.delivery === 'unknown') renderRecovery(recovery)
}

function renderResponse(
  failure: Extract<FailureDiagnostic, { kind: 'response' }>,
  machine: boolean,
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
      : (removalHint ?? (upgrade ? schemaUpgradeHint(upgrade) : undefined))
  if (machine) {
    writeRaw({
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
  }
  if (hint) log.dim(`  ${hint}`)
}

function renderRecovery(recovery: OperationRecovery | undefined): void {
  if (!recovery)
    return log.dim('  Delivery is unknown; do not automatically retry a mutating call.')
  log.dim('  Delivery is unknown; retry with the same operation id:')
  log.dim(`  operation: ${recovery.operation}`)
  log.dim(`  ${recovery.retry}`)
}

const writeRaw = (payload: Record<string, unknown>): void =>
  void process.stderr.write(`${JSON.stringify(payload)}\n`)
