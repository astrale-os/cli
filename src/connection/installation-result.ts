import type {
  Installation,
  InstallResult,
  Uninstallation,
  UninstallReceipt,
} from '@astrale-os/sdk/client/schema'

import type { OperationRecovery } from './command'

import { log } from '../lib/terminal/log'

/** A successful call can still describe an unfinished or rejected installation. */
export class IncompleteInstallation extends Error {
  constructor(
    readonly installation: Installation | Uninstallation,
    readonly kind: 'install' | 'uninstall' = 'install',
  ) {
    super(`Installation ${installation.execution} is ${installation.status.state}.`)
  }
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

/** Preserve the admitted Execution status, including migration details and repair progress. */
export function renderIncompleteInstallation(
  error: IncompleteInstallation,
  machine: boolean,
  recovery?: OperationRecovery,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  const { execution, status } = error.installation
  const outcome = status.outcome
  const failure = outcome?.kind === 'failed' ? outcome.error : undefined
  const code =
    failure?.code ??
    (outcome?.kind === 'cancelled' ? 'INSTALLATION_CANCELLED' : 'INSTALLATION_PENDING')
  const message = failure?.message ?? error.message
  if (machine) {
    process.stderr.write(
      `${JSON.stringify({
        ...fields,
        error: code,
        message,
        execution,
        lifecycle: error.kind,
        status,
        ...recovery,
      })}\n`,
    )
    return
  }
  log.error(`${code}: ${message}`)
  log.dim(
    `  execution: ${execution} (${status.state}${status.detail === undefined ? '' : `; ${status.detail.phase}`})`,
  )
  if (status.detail?.phase === 'awaiting') {
    log.dim(
      `  Repair session is waiting for command:${status.detail.command}. Read its status before applying or cancelling.`,
    )
  }
  log.dim(
    `  Read the existing run: astrale domain installation status ${execution}${error.kind === 'uninstall' ? ' --uninstall' : ''} (with the same Instance and identity)`,
  )
  if (recovery !== undefined) {
    log.dim(`  operation: ${recovery.operation}`)
    log.dim(`  Observe the same installation with its exact intent: ${recovery.retry}`)
  }
}
