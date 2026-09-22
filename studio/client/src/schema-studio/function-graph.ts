/**
 * function-graph.ts — the standalone Functions, projected onto the schema canvas.
 *
 * A Function is the one callable with no receiver, so before this it was the one
 * schema member the canvas did not draw: it lived only in the rail. It gets the same
 * treatment a view does — a node of its own (`function.<name>`, the ref its comments
 * already anchor to) tied by a quiet dashed edge to each local Class it accepts, and a
 * Function that names none simply arrives unconnected. Pure derivation: positions come
 * from the layout engine like every other node.
 */
import type { StudioSchemaBundle } from '@shared/types'
import type { Edge, Node } from '@xyflow/react'

import type { FunctionModel, FunctionsModel } from '@/lib/functions'

import { moduleOfClass } from './modules'
import { FUNCTION_H, FUNCTION_W } from './palette'
import { type Hidden, classNodeVisible } from './visibility'

export interface FunctionNodeData extends Record<string, unknown> {
  domainId: string
  fn: FunctionModel
}

/** The canvas id (and comment anchor) of a standalone Function. */
export const functionNodeId = (name: string) => `function.${name}`

/**
 * Project the domain's standalone Functions into canvas nodes + the Classes they work on.
 *
 * `collapsed` and `hidden` are honoured exactly as the view graph honours them: a
 * Function whose Class is folded into its module box binds to the box instead, and one
 * whose Class is hidden keeps only the node, never a dangling edge.
 */
export function functionGraph(
  model: FunctionsModel,
  bundle: StudioSchemaBundle,
  collapsed: Set<string>,
  hidden: Hidden,
): { nodes: Node[]; edges: Edge[] } {
  if (!bundle.ir) return { nodes: [], edges: [] }

  const nodes: Node[] = []
  const edges: Edge[] = []

  for (const fn of model.all) {
    nodes.push({
      id: functionNodeId(fn.name),
      type: 'functionNode',
      position: { x: 0, y: 0 },
      data: { domainId: bundle.domainId, fn } satisfies FunctionNodeData,
      style: { width: FUNCTION_W, height: FUNCTION_H },
    })

    for (const className of fn.boundClasses) {
      if (!classNodeVisible(className, hidden)) continue
      const modulePath = moduleOfClass(bundle, className)
      const target = collapsed.has(modulePath) ? `grp-${modulePath}` : `class.${className}`
      edges.push({
        id: `function-${fn.name}__${target}`,
        source: functionNodeId(fn.name),
        target,
        type: 'floating',
        // No label: the pill at the end of the wire already names the Function, and the
        // relation it stands for — "works on" — is the only one this edge ever means.
        data: { kind: 'function', ownerDomainId: bundle.domainId },
        style: {
          stroke: 'var(--edge-function)',
          strokeWidth: 1.3,
          strokeDasharray: '2 4',
        },
      })
    }
  }

  return { nodes, edges }
}

/** Structure fingerprint: what must change before the canvas is rebuilt. */
export function functionGraphKey(model: FunctionsModel): string {
  return model.all
    .map((fn) => `${fn.name}:${fn.boundClasses.join('+')}:${fn.link?.kind ?? ''}`)
    .join('|')
}
