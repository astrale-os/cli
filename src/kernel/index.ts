export { withKernelClient, withAdminKernelClient, type ClientContext } from './client'
export { resolveCredential } from './auth'
export { formatKernelError } from './errors'
export {
  buildSelfContext,
  expandSelfInPath,
  withSelfHint,
  resolveOrThrow,
  resolveSelfIdLazy,
  type SelfExpansionMeta,
} from './expand'
export { mintRemoteCredential } from './remote-routing'
export { runKernelCommand, extractItems } from './run'
export type { KernelCommandOpts, CallCommandOpts } from './types'
