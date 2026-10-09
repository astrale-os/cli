/**
 * view-graph.ts - the declared views, projected onto the schema canvas.
 *
 * A view is what the domain actually shows a human, so it belongs ON the graph,
 * not behind a toolbar button. Each view becomes a node of its own (`view.<slug>`,
 * the same ref its comments anchor to). Every View belongs to its Domain and is
 * bound to no Class, so views arrive unconnected and dock with the application.
 * Pure derivation: positions come from the layout engine like every other node.
 */
import type { StudioSchemaBundle } from '@shared/types'
import type { Edge, Node } from '@xyflow/react'

import type { ViewModel, ViewsModel } from '@/lib/views'

import { VIEW_H, VIEW_W } from './palette'

export interface ViewNodeData extends Record<string, unknown> {
  domainId: string
  view: ViewModel
}

/** The canvas id (and comment anchor) of a view. */
export const viewNodeId = (slug: string) => `view.${slug}`

/** Project the domain's views into canvas nodes. Views bind to no Class, so they bring no edge. */
export function viewGraph(
  model: ViewsModel,
  bundle: StudioSchemaBundle,
): { nodes: Node[]; edges: Edge[] } {
  if (!bundle.ir) return { nodes: [], edges: [] }
  const nodes: Node[] = model.all.map((view) => ({
    id: viewNodeId(view.slug),
    type: 'viewNode',
    position: { x: 0, y: 0 },
    data: { domainId: bundle.domainId, view } satisfies ViewNodeData,
    style: { width: VIEW_W, height: VIEW_H },
  }))
  return { nodes, edges: [] }
}

/** Structure fingerprint: what must change before the canvas is rebuilt. */
export function viewGraphKey(model: ViewsModel): string {
  return model.all.map((view) => `${view.slug}:${view.drift}`).join('|')
}
