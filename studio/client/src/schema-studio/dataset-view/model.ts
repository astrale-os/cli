import type { StudioCore, StudioDataset, StudioDatasetFailure } from '@shared/types'

import type { PolicyMatch, PolicyObject } from './policy-evaluate'

import {
  type CoreSpotlight,
  type SpotlightMark,
  type SpotlightTone,
  coreEdgeId,
  displayName,
  lastSeg,
  nodeAnchor,
} from '../core-view/model'

export function isReadyDataset(
  entry: StudioDataset | StudioDatasetFailure | undefined,
): entry is StudioDataset {
  return entry?.status === 'ready'
}

export function datasetLabel(dataset: Pick<StudioDataset, 'id' | 'title'>): string {
  return dataset.title?.trim() || dataset.id
}

/**
 * A Dataset read as Core data: the canvas, tree rows and detail panel already draw exactly
 * this shape, so demo facts reuse them instead of growing a second renderer.
 */
export function datasetCore(dataset: StudioDataset): StudioCore {
  return {
    domain: dataset.origin,
    nodes: dataset.nodes,
    edges: dataset.edges,
    error: null,
    extractedAt: '',
  }
}

/** A node's name as the canvas shows it, from its id alone. */
export function nodeLabel(core: StudioCore, id: string): string {
  const node = core.nodes.find((candidate) => candidate.path === id)
  return node ? displayName(node) : lastSeg(id)
}

/** An edge as a reader names it: `Ada —owns→ Inbox`. */
export function edgeLabel(core: StudioCore, index: number): string {
  const edge = core.edges[index]
  if (!edge) return `edge #${index}`
  return `${nodeLabel(core, edge.from)} —${edge.edgeName}→ ${nodeLabel(core, edge.to)}`
}

export const sameObject = (left: PolicyObject | null, right: PolicyObject | null): boolean =>
  left?.kind === right?.kind &&
  (left?.kind === 'node'
    ? left.id === (right as { id: string }).id
    : left?.kind === 'edge'
      ? left.index === (right as { index: number }).index
      : true)

/**
 * The canvas reading of what a policy found: every node and edge its proofs run through,
 * in React Flow ids. `marks` label the picked subject and object so a reader can tell the
 * two ends of a proof apart from the nodes it passes by.
 */
export function proofSpotlight(
  matches: readonly PolicyMatch[],
  tone: SpotlightTone,
  picked: { subject: string | null; object: PolicyObject | null },
  core: StudioCore,
): CoreSpotlight {
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  for (const match of matches) {
    for (const node of match.nodes) nodeIds.add(nodeAnchor(node))
    for (const edge of match.edges) edgeIds.add(coreEdgeId(edge))
  }
  const marks = new Map<string, SpotlightMark>()
  if (picked.subject) {
    nodeIds.add(nodeAnchor(picked.subject))
    marks.set(nodeAnchor(picked.subject), 'subject')
  }
  if (picked.object?.kind === 'node') {
    nodeIds.add(nodeAnchor(picked.object.id))
    marks.set(nodeAnchor(picked.object.id), 'object')
  } else if (picked.object?.kind === 'edge') {
    const edge = core.edges[picked.object.index]
    if (edge) {
      edgeIds.add(coreEdgeId(picked.object.index))
      nodeIds.add(nodeAnchor(edge.from))
      nodeIds.add(nodeAnchor(edge.to))
    }
  }
  return { nodeIds, edgeIds, tone, marks }
}
