import { formatKernelError } from '../../connection/errors'
import { isMachine, type OutputOpts } from '../../lib/terminal/output'

/** Present a failed issue command like every Kernel-touching command (typed refusals, hints), then exit. */
export async function failIssueCommand(
  cause: unknown,
  options: OutputOpts & { readonly debug?: boolean },
): Promise<never> {
  await formatKernelError(cause, isMachine(options), '', options.debug)
  process.exit(1)
}
