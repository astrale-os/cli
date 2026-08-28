/**
 * view-graph.ts — the declared views, projected onto the schema canvas.
 *
 * A view is what the domain actually shows a human, so it belongs ON the graph
 * next to the class it renders, not behind a toolbar button. Each view becomes a
 * node of its own (`view.<slug>` — the same ref its comments anchor to) tied to
 * its bound class by a quiet dashed edge; standalone views simply arrive
 * unconnected. Pure derivation: positions come from the layout engine like every
 * other node.
 */
import type { StudioSchemaBundle } from '@shared/types'
import type { Edge, Node } from '@xyflow/react'

import type { ViewModel, ViewsModel } from '@/lib/views'

import { moduleOfClass } from './modules'
import { VIEW_H, VIEW_W } from './palette'
import { type Hidden, classNodeVisible } from './visibility'

export interface ViewNodeData extends Record<string, unknown> {
  domainId: string
  view: ViewModel
}

/** The canvas id (and comment anchor) of a view. */
export const viewNodeId = (slug: string) => `view.${slug}`

/**
 * Project the domain's views into canvas nodes + their bindings.
 *
 * `collapsed` and `hidden` are honoured the way class edges honour them: a view
 * whose class is folded into its module box binds to the box instead, and a view
 * whose class is hidden keeps only the node, never a dangling edge.
 */
export function viewGraph(
  model: ViewsModel,
  bundle: StudioSchemaBundle,
  collapsed: Set<string>,
  hidden: Hidden,
): { nodes: Node[]; edges: Edge[] } {
  const ir = bundle.ir
  if (!ir) return { nodes: [], edges: [] }

  const nodes: Node[] = []
  const edges: Edge[] = []

  for (const view of model.all) {
    nodes.push({
      id: viewNodeId(view.slug),
      type: 'viewNode',
      position: { x: 0, y: 0 },
      data: { domainId: bundle.domainId, view } satisfies ViewNodeData,
      style: { width: VIEW_W, height: VIEW_H },
    })

    for (const className of view.boundClasses) {
      if (!classNodeVisible(className, hidden)) continue
      const modulePath = moduleOfClass(bundle, className)
      const target = collapsed.has(modulePath) ? `grp-${modulePath}` : `class.${className}`
      edges.push({
        id: `view-${view.slug}__${target}`,
        source: viewNodeId(view.slug),
        target,
        type: 'floating',
        // No label: the pill at the end of the wire already says which view this is,
        // and a second copy mid-edge is noise on a canvas that is mostly labels.
        data: { kind: 'view', ownerDomainId: bundle.domainId },
        style: {
          stroke: 'var(--edge-view)',
          strokeWidth: 1.3,
          strokeDasharray: '2 4',
        },
      })
    }
  }

  return { nodes, edges }
}

/** Structure fingerprint: what must change before the canvas is rebuilt. */
export function viewGraphKey(model: ViewsModel): string {
  return model.all
    .map((view) => `${view.slug}:${view.boundClasses.join('+')}:${view.drift}`)
    .join('|')
}
