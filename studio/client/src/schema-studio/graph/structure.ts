/**
 * structure.ts — the two layers the canvas draws over the graph itself.
 *
 * Focus: which nodes and edges a click reaches, so the rest can recede.
 */
import type { Edge } from '@xyflow/react'

export function neighborSet(activeId: string, edges: Edge[]) {
  const nodeIds = new Set<string>([activeId])
  const edgeIds = new Set<string>()
  for (const e of edges) {
    if (e.source === activeId) {
      nodeIds.add(e.target)
      edgeIds.add(e.id)
    } else if (e.target === activeId) {
      nodeIds.add(e.source)
      edgeIds.add(e.id)
    }
  }
  return { nodeIds, edgeIds }
}

/** Every path a relationship class is drawn as, inside the domain that declares it. A class
 * can fan out into several — one per pair of endpoint classes it resolves to. */
export function relationshipEdgeIds(edges: Edge[], domainId: string, name: string): string[] {
  return edges
    .filter((edge) => edge.data?.edgeClass === name && edge.data?.ownerDomainId === domainId)
    .map((edge) => edge.id)
}

/**
 * The rendered paths a relationship selection lights up, and the cards they run between.
 *
 * Which paths those are depends on how the relationship was picked: clicking ONE line means
 * that line, while NAMING the relationship (⌘K, the rail, a comment's anchor) means every
 * line it is drawn as. Both arrive here as physical edge ids — the schema class alone could
 * not tell the two readings apart.
 */
export function selectedRelationshipContext(edgeIds: readonly string[], edges: Edge[]) {
  if (edgeIds.length === 0) return null
  const wanted = new Set(edgeIds)
  const found = new Set<string>()
  const nodeIds = new Set<string>()
  for (const edge of edges) {
    if (!wanted.has(edge.id)) continue
    found.add(edge.id)
    nodeIds.add(edge.source)
    nodeIds.add(edge.target)
  }
  return found.size > 0 ? { edgeIds: found, nodeIds } : null
}
