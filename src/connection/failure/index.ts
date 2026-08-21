import type { OperationRecovery } from '../command'

import { classifyFailure } from './classify'
import { printFailureDebug } from './debug'
import { renderFailure } from './render'

export { functionInputIssues, schemaUpgradeHint } from '../reasons'

export async function formatKernelError(
  error: unknown,
  machine: boolean,
  urlArg = '',
  debug = false,
  options: { recovery?: OperationRecovery } = {},
): Promise<void> {
  renderFailure(classifyFailure(error), machine, urlArg, options.recovery)
  if (debug) printFailureDebug(error, urlArg)
}
