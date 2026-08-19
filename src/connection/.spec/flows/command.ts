import type { ConnectionContext, KernelCommandOpts } from '../api.js'

declare const open: <Value>(
  options: KernelCommandOpts,
  action: (context: ConnectionContext) => Promise<Value>,
) => Promise<Value>
declare const present: <Value>(value: Value) => void | Promise<void>
declare const mapExpectedFailure: (error: unknown) => Promise<void>

/** One command owns progress and error presentation around one terminal ClientSession lifecycle. */
export async function runKernelCommand<Value>(
  options: KernelCommandOpts,
  action: (context: ConnectionContext) => Promise<Value>,
): Promise<void> {
  try {
    await present(await open(options, action))
  } catch (error) {
    await mapExpectedFailure(error)
  }
}
