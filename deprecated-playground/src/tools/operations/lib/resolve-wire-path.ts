import { K } from '@astrale-os/kernel-core'

import type { BusinessGraph } from '@/tools/graph-state/lib/raw-to-business'

const FUNCTION_REF_KEY = K.$.i('Function').ref.key

/**
 * Result of resolving a Function's wire path from the graph.
 *
 * `kind: 'ok'` → a concrete path ready to be passed to `client.call(...)`.
 * Any other kind means the graph does not contain enough info to build a
 * valid wire path; the caller should disable the operation in the UI rather
 * than fabricate something broken.
 */
export type WirePathResolution =
  | { kind: 'ok'; path: string }
  | { kind: 'missing-node'; ref: string }
  | { kind: 'missing-path'; ref: string; nodeId: string }

/**
 * Build the wire path for a Function given its canonical ref.
 *
 * The canonical tree layout (see `kernel/core/domain/addressing/layout/default.ts`)
 * places each Function node — method or standalone — at the exact path used on
 * the wire. Methods sit at `/origin/class.Name/methodName` (siblings of the
 * class's `/self` node, parented via `has_parent`). So the Function node's own
 * tree path, computed by `buildPath` during `rawToBusiness`, is already the
 * wire path — no `method_of` climb needed.
 */
export function resolveWirePath(fnRef: string, graph: BusinessGraph): WirePathResolution {
  const fnNode = graph.nodes.find((n) => n.properties[FUNCTION_REF_KEY] === fnRef)
  if (!fnNode) return { kind: 'missing-node', ref: fnRef }
  if (!fnNode.path) return { kind: 'missing-path', ref: fnRef, nodeId: fnNode.id }
  return { kind: 'ok', path: fnNode.path }
}

export function describeResolutionFailure(r: Exclude<WirePathResolution, { kind: 'ok' }>): string {
  switch (r.kind) {
    case 'missing-node':
      return `Function "${r.ref}" not found in the current graph`
    case 'missing-path':
      return `Function node has no resolvable tree path`
  }
}
