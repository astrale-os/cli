/**
 * Raw-to-Graph Transform
 *
 * Pure function that interprets raw GraphStateData (FalkorDB dump)
 * into an interpreted graph by:
 *   1. Resolving node classes via classId + Class node index (labels as fallback)
 *   2. Collapsing reified edges (edge-nodes with from/to) into direct edges
 *   3. Filtering structural edges (instance_of, from, to, symlink, auth)
 *   4. Keeping has_parent + domain edges (implements, extends, method_of, of_domain)
 */

import type { GraphStateData, GraphStateNode } from '@/lib/types'

import {
  STRUCTURE_TYPE,
  STRUCTURE_LABEL,
  DOMAIN_LABEL,
  DOMAIN_TYPE,
  HIDDEN_EDGE_TYPES,
} from './kernel-fabric'

export interface BusinessNode {
  id: string
  className: string | null
  displayName: string
  path: string | null
  properties: Record<string, unknown>
  rawLabels: string[]
}

export interface BusinessEdge {
  id: string
  type: string
  sourceId: string
  targetId: string
  properties: Record<string, unknown>
  reified: boolean
}

export interface ClassInfo {
  name: string
  kind: 'node' | 'edge'
  count: number
}

export interface BusinessGraph {
  nodes: BusinessNode[]
  edges: BusinessEdge[]
  nodeClasses: ClassInfo[]
  edgeClasses: ClassInfo[]
  meta: {
    totalRawNodes: number
    totalRawEdges: number
    filteredNodes: number
    filteredEdges: number
    collapsedReifiedEdges: number
  }
}

export interface GraphViewOptions {
  hiddenClasses?: Set<string>
  hiddenDomains?: Set<string>
}

export const DISPLAY_NAME_KEYS = ['name'] as const

// Fields synthesized by `kernelTreeToGraphState` alongside the real stored
// properties. Excluded from BusinessNode.properties so the inspector renders
// only what storage actually holds.
const NON_PROPERTY_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'labels',
  '_labels',
  'name',
  'slug',
  'path',
  'classId',
  'type',
  'key',
])

export function resolveDisplayName(node: GraphStateNode): string {
  for (const key of DISPLAY_NAME_KEYS) {
    const val = node[key]
    if (typeof val === 'string' && val.length > 0) return val
  }
  return node.id.length > 20 ? node.id.slice(-8) : node.id
}

export function rawToBusiness(raw: GraphStateData, options: GraphViewOptions = {}): BusinessGraph {
  const { hiddenClasses, hiddenDomains } = options

  // 0. Build set of node IDs to hide by domain membership
  const domainHiddenNodeIds = new Set<string>()
  if (hiddenDomains && hiddenDomains.size > 0) {
    // Find Domain nodes matching hidden domain names (check name, slug, key)
    const hiddenDomainNodeIds = new Set<string>()
    for (const n of raw.nodes) {
      if (!n.labels?.includes(DOMAIN_LABEL.Domain)) continue
      const candidates = [n.name, n.slug, n.key].filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      )
      const matches = candidates.some(
        (c) => hiddenDomains.has(c) || hiddenDomains.has(c.split('.')[0]),
      )
      if (matches) {
        hiddenDomainNodeIds.add(n.id)
        domainHiddenNodeIds.add(n.id) // hide the Domain node itself
      }
    }
    // Find all nodes connected via of_domain to those Domain nodes
    for (const e of raw.edges) {
      if (e.type === DOMAIN_TYPE.ofDomain && hiddenDomainNodeIds.has(e.dest)) {
        // Keep Root nodes visible
        const node = raw.nodes.find((n) => n.id === e.src)
        if (node?.labels?.includes(DOMAIN_LABEL.Root)) continue
        domainHiddenNodeIds.add(e.src)
      }
    }
    // Also hide children (via has_parent) of domain-hidden nodes, recursively
    let changed = true
    while (changed) {
      changed = false
      for (const e of raw.edges) {
        if (e.type !== STRUCTURE_TYPE.hasParent) continue
        if (!domainHiddenNodeIds.has(e.dest)) continue
        if (domainHiddenNodeIds.has(e.src)) continue
        const node = raw.nodes.find((n) => n.id === e.src)
        if (node?.labels?.includes(DOMAIN_LABEL.Root)) continue
        domainHiddenNodeIds.add(e.src)
        changed = true
      }
    }
  }

  // 1. Index Class nodes: classNodeId → { name, kind }
  const classNodeIndex = new Map<string, { name: string; kind: 'node' | 'edge' }>()
  for (const n of raw.nodes) {
    if (!n.labels?.includes(STRUCTURE_LABEL.Class)) continue
    const className =
      (typeof n.name === 'string' && n.name) ||
      (typeof n.slug === 'string' && n.slug) ||
      (typeof n.key === 'string' && n.key)
    if (!className) continue
    const kind = n.type === 'edge' ? ('edge' as const) : ('node' as const)
    classNodeIndex.set(n.id, { name: className, kind })
  }

  // 2. Resolve class for each node via classId, falling back to labels
  const nodeClassIndex = new Map<string, string>()
  const knownClassNames = new Set([
    ...Array.from(classNodeIndex.values()).map((c) => c.name),
    ...Object.values(DOMAIN_LABEL),
  ])
  for (const n of raw.nodes) {
    const classId = (n as Record<string, unknown>).classId as string | null | undefined
    if (classId && classNodeIndex.has(classId)) {
      nodeClassIndex.set(n.id, classNodeIndex.get(classId)!.name)
      continue
    }
    if (n.labels?.length) {
      const classLabel = n.labels.find((l) => knownClassNames.has(l))
      if (classLabel) {
        nodeClassIndex.set(n.id, classLabel)
      }
    }
  }

  // 3. Identify reified edge nodes by finding from/to pairs
  const fromIndex = new Map<string, string>()
  const toIndex = new Map<string, string>()
  for (const e of raw.edges) {
    if (e.type === STRUCTURE_TYPE.from) fromIndex.set(e.dest, e.src)
    if (e.type === STRUCTURE_TYPE.to) toIndex.set(e.src, e.dest)
  }

  const reifiedNodeIds = new Set<string>()
  const graphEdges: BusinessEdge[] = []
  let collapsedReifiedEdges = 0

  for (const [edgeNodeId, sourceId] of fromIndex) {
    const targetId = toIndex.get(edgeNodeId)
    if (!targetId) continue
    reifiedNodeIds.add(edgeNodeId)
    collapsedReifiedEdges++

    const edgeNode = raw.nodes.find((n) => n.id === edgeNodeId)
    const className = nodeClassIndex.get(edgeNodeId)
    const {
      id: _id,
      labels: _labels,
      _labels: _l,
      ...props
    } = (edgeNode ?? {}) as Record<string, unknown>

    graphEdges.push({
      id: edgeNodeId,
      type: className ?? 'unknown',
      sourceId,
      targetId,
      properties: props,
      reified: true,
    })
  }

  // 4. Collect visible edges (domain + distribution — skip structural & auth)
  for (const e of raw.edges) {
    if (HIDDEN_EDGE_TYPES.has(e.type)) continue
    graphEdges.push({
      id: `${e.type}:${e.src}:${e.dest}`,
      type: e.type,
      sourceId: e.src,
      targetId: e.dest,
      properties: e.props ?? {},
      reified: false,
    })
  }

  // 4b. Synthesize instance_of edges from classId (kernel no longer stores them as edges)
  for (const n of raw.nodes) {
    const classId = (n as Record<string, unknown>).classId as string | null | undefined
    if (classId && classNodeIndex.has(classId)) {
      graphEdges.push({
        id: `instance_of:${n.id}:${classId}`,
        type: STRUCTURE_TYPE.instanceOf,
        sourceId: n.id,
        targetId: classId,
        properties: {},
        reified: false,
      })
    }
  }

  // 5. Build path index from has_parent edges
  const parentOf = new Map<string, string>()
  const pathSegmentOf = new Map<string, string>()
  for (const e of raw.edges) {
    if (e.type === STRUCTURE_TYPE.hasParent) parentOf.set(e.src, e.dest)
  }
  const rootIds = new Set<string>()
  for (const n of raw.nodes) {
    const slug = typeof n.slug === 'string' ? n.slug : null
    if (!slug) {
      if (!parentOf.has(n.id)) {
        rootIds.add(n.id)
      } else {
        console.error(`[graph-state] node ${n.id} has no slug`)
      }
      continue
    }
    pathSegmentOf.set(n.id, slug)
  }

  function buildPath(nodeId: string): string | null {
    if (rootIds.has(nodeId)) return '/'
    const parts: string[] = []
    let cur: string | undefined = nodeId
    const visited = new Set<string>()
    while (cur) {
      if (visited.has(cur)) break
      visited.add(cur)
      const segment = pathSegmentOf.get(cur)
      if (segment) parts.unshift(segment)
      cur = parentOf.get(cur)
    }
    return parts.length > 0 ? '/' + parts.join('/') : null
  }

  // 6. Build nodes — all except reified edge-nodes and hidden classes
  const graphNodes: BusinessNode[] = []
  const includedNodeIds = new Set<string>()

  for (const n of raw.nodes) {
    if (reifiedNodeIds.has(n.id)) continue
    if (domainHiddenNodeIds.has(n.id)) continue
    const className = nodeClassIndex.get(n.id) ?? null
    if (hiddenClasses && className && hiddenClasses.has(className)) continue

    // `properties` reflects what storage actually holds — exclude both the
    // graph-shape fields (`id`, `labels`, `_labels`) and the structural fields
    // synthesized by `kernelTreeToGraphState` (`name`, `slug`, `path`,
    // `classId`, `type`, `key`), which are surfaced separately on BusinessNode.
    const properties: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(n)) {
      if (NON_PROPERTY_FIELDS.has(k)) continue
      properties[k] = v
    }

    graphNodes.push({
      id: n.id,
      className,
      displayName: resolveDisplayName(n),
      path: buildPath(n.id),
      properties,
      rawLabels: n.labels ?? [],
    })
    includedNodeIds.add(n.id)
  }

  // 6. Filter edges: both endpoints must be visible, and edge class not hidden
  const visibleEdges = graphEdges.filter((e) => {
    if (!includedNodeIds.has(e.sourceId) || !includedNodeIds.has(e.targetId)) return false
    if (hiddenClasses && hiddenClasses.has(e.type)) return false
    return true
  })

  // 7. Collect class info with counts, distinguishing node vs edge classes
  const nodeClassCounts = new Map<string, number>()
  for (const n of graphNodes) {
    if (!n.className) continue
    nodeClassCounts.set(n.className, (nodeClassCounts.get(n.className) ?? 0) + 1)
  }

  const edgeClassCounts = new Map<string, number>()
  for (const e of visibleEdges) {
    edgeClassCounts.set(e.type, (edgeClassCounts.get(e.type) ?? 0) + 1)
  }

  // Also include classes from classNodeIndex that may have 0 visible instances
  for (const [, info] of classNodeIndex) {
    if (info.kind === 'node' && !nodeClassCounts.has(info.name)) nodeClassCounts.set(info.name, 0)
    if (
      info.kind === 'edge' &&
      !HIDDEN_EDGE_TYPES.has(info.name) &&
      !edgeClassCounts.has(info.name)
    )
      edgeClassCounts.set(info.name, 0)
  }

  const nodeClasses: ClassInfo[] = [...nodeClassCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, kind: 'node', count }))

  const edgeClasses: ClassInfo[] = [...edgeClassCounts.entries()]
    .sort(([a], [b]) => {
      // has_parent always first
      if (a === STRUCTURE_TYPE.hasParent) return -1
      if (b === STRUCTURE_TYPE.hasParent) return 1
      return a.localeCompare(b)
    })
    .map(([name, count]) => ({ name, kind: 'edge', count }))

  return {
    nodes: graphNodes,
    edges: visibleEdges,
    nodeClasses,
    edgeClasses,
    meta: {
      totalRawNodes: raw.nodes.length,
      totalRawEdges: raw.edges.length,
      filteredNodes: graphNodes.length,
      filteredEdges: visibleEdges.length,
      collapsedReifiedEdges,
    },
  }
}
