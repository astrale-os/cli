/**
 * policy-graph.ts — a Dataset indexed for policy evaluation.
 *
 * The canvas shape (`StudioCore`) is a flat list of nodes and edges. A policy proof walks that
 * graph by edge class, in either direction, and asks whether a node IS a given class — through
 * inheritance, across imported domains — or a principal at all. This index answers those
 * questions once per Dataset, so the evaluator stays a plain search.
 */
import type { IrClassRef, IrSchemaRef, StudioCore, StudioSchemaBundle } from '@shared/types'

import { classRefKey, parseClassRefKey } from '@shared/types'

import { kernelRolesOfClass, resolveClass } from '../inheritance'

export interface DataEdge {
  /** position in `StudioCore.edges` — the canvas keys its typed edges the same way */
  index: number
  from: string
  to: string
  /** the class as the Dataset names it: a local name, or the exact key of an imported class */
  edgeName: string
  undirected: boolean
}

export interface DataGraph {
  origin: string
  nodeIds: string[]
  /** node id → the class name the Dataset gave it */
  classOf: Map<string, string>
  edges: DataEdge[]
  byClass: Map<string, DataEdge[]>
  /** edges a walk can leave a node by (both ends of an undirected edge) */
  outgoing: Map<string, DataEdge[]>
  /** edges a walk can arrive at a node by (both ends of an undirected edge) */
  incoming: Map<string, DataEdge[]>
  /** nodes whose class descends from the kernel Identity — the possible subjects */
  identities: string[]
  /** the Dataset's name for a class ref */
  nameOf(ref: IrSchemaRef): string
  isInstance(nodeId: string, ref: IrSchemaRef): boolean
  isIdentity(nodeId: string): boolean
  /**
   * Whether a proof may bind the subject to this node. The subject is the authenticated
   * principal, so only an Identity qualifies — unless the Dataset shows none at all, in which
   * case the Studio cannot tell principals apart and lets any node stand in.
   */
  mayBeSubject(nodeId: string): boolean
}

/** The ref a Dataset class name stands for: local names belong to the Dataset's own domain. */
export function classRefOf(className: string, origin: string): IrClassRef {
  return parseClassRefKey(className) ?? { origin, kind: 'class', name: className }
}

const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

export function buildDataGraph(core: StudioCore, bundle: StudioSchemaBundle): DataGraph {
  const origin = core.domain
  const classOf = new Map(core.nodes.map((node) => [node.path, node.className]))
  const nodeIds = core.nodes.map((node) => node.path)

  // Everything a class IS, own ref included, walked once per distinct class name.
  const ancestry = new Map<string, Set<string>>()
  const ancestorsOf = (className: string): Set<string> => {
    const cached = ancestry.get(className)
    if (cached) return cached
    const found = new Set<string>()
    const queue: IrClassRef[] = [classRefOf(className, origin)]
    while (queue.length > 0) {
      const ref = queue.shift()!
      const key = classRefKey(ref)
      if (found.has(key)) continue
      found.add(key)
      queue.push(...(resolveClass(bundle, ref)?.extendsRefs ?? []))
    }
    ancestry.set(className, found)
    return found
  }
  const identityCache = new Map<string, boolean>()
  const classIsIdentity = (className: string): boolean => {
    const cached = identityCache.get(className)
    if (cached !== undefined) return cached
    const value = kernelRolesOfClass(bundle, [classRefOf(className, origin)]).includes('identity')
    identityCache.set(className, value)
    return value
  }

  const nameOf = (ref: IrSchemaRef): string =>
    ref.origin === origin ? ref.name : classRefKey({ ...ref, kind: 'class' })
  const isUndirected = (edgeName: string): boolean =>
    resolveClass(bundle, classRefOf(edgeName, origin))?.orientation === 'undirected'

  const edges: DataEdge[] = core.edges.map((edge, index) => ({
    index,
    from: edge.from,
    to: edge.to,
    edgeName: edge.edgeName,
    undirected: isUndirected(edge.edgeName),
  }))
  const byClass = new Map<string, DataEdge[]>()
  const outgoing = new Map<string, DataEdge[]>()
  const incoming = new Map<string, DataEdge[]>()
  for (const edge of edges) {
    push(byClass, edge.edgeName, edge)
    push(outgoing, edge.from, edge)
    push(incoming, edge.to, edge)
    if (edge.undirected && edge.from !== edge.to) {
      push(outgoing, edge.to, edge)
      push(incoming, edge.from, edge)
    }
  }

  const isIdentity = (nodeId: string): boolean => {
    const className = classOf.get(nodeId)
    return className !== undefined && classIsIdentity(className)
  }

  const identities = nodeIds.filter(isIdentity)

  return {
    origin,
    nodeIds,
    classOf,
    edges,
    byClass,
    outgoing,
    incoming,
    identities,
    nameOf,
    mayBeSubject: (nodeId) => identities.length === 0 || isIdentity(nodeId),
    isInstance: (nodeId, ref) => {
      const className = classOf.get(nodeId)
      return (
        className !== undefined &&
        ancestorsOf(className).has(classRefKey({ ...ref, kind: 'class' }))
      )
    },
    isIdentity,
  }
}
