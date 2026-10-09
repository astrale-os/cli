import type { OperationRecovery } from '../command'

import { printFailureDebug } from '../../lib/failure-debug'
import { classifyFailure } from './classify'
import { renderFailure } from './render'

export { functionInputIssues, schemaUpgradeHint } from '../reasons'

export async function formatKernelError(
  error: unknown,
  machine: boolean,
  urlArg = '',
  debug = false,
  options: {
    recovery?: OperationRecovery
    /** Members the command adds beside a Kernel refusal's `--json` document, never over its own. */
    fields?: Readonly<Record<string, unknown>>
  } = {},
): Promise<void> {
  renderFailure(classifyFailure(error), machine, urlArg, options.recovery, options.fields)
  if (debug) printFailureDebug(error, urlArg)
}
