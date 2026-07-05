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
export { runKernelCommand } from './run'
export { bindGraph, splitRoot, childrenCursor, nodeProp, unqualifyKey } from './graph'
export type {
  GetResultWire,
  GraphApi,
  GraphNode,
  GraphNodeWire,
  MutationResultWire,
  PatchInput,
  QueryASTInput,
} from './graph'
export type { KernelCommandOpts, CallCommandOpts } from './types'
