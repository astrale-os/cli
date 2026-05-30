export { withKernelClient, type ClientContext } from './client'
export { resolveCredential } from './auth'
export { formatKernelError } from './errors'
export {
  buildSelfContext,
  expandSelfInPath,
  withSelfHint,
  resolveOrThrow,
  type SelfExpansionMeta,
} from './expand'
export { lookupRemoteBinding, mintRemoteCredential, type RemoteBinding } from './remote-routing'
export { runKernelCommand, extractItems } from './run'
export type { KernelCommandOpts, CallCommandOpts } from './types'
