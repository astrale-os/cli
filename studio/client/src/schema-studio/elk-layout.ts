import type { Edge, Node } from '@xyflow/react'
import type { ELK, ElkNode } from 'elkjs/lib/elk-api.js'

import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url'

import { CLASS_H, CLASS_W, MODULE_HEADER, MODULE_PAD } from './palette'

// Compound/nested auto-layout for the module graph. ELK is the only mainstream
// engine with first-class nested-group support, which we need because our
// folder → file → class modules are literal React Flow parent containers. ELK
// returns child x/y RELATIVE to the parent — exactly what React Flow expects, so
// the flat-parentId ⇄ nested-children transform round-trips cleanly.

let enginePromise: Promise<ELK> | undefined

function layoutEngine(): Promise<ELK> {
  enginePromise ??= import('elkjs/lib/elk-api.js').then(
    ({ default: ElkConstructor }) => new ElkConstructor({ workerUrl: elkWorkerUrl }),
  )
  return enginePromise
}

// Spacing is tuned against the RENDERED node size (see palette.ts): rows sit one
// node-height apart, columns leave room for a label on the connecting edge.
const OPTS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN', // let edges cross module boundaries
  'elk.layered.spacing.nodeNodeBetweenLayers': '96',
  'elk.spacing.nodeNode': '28',
  'elk.spacing.componentComponent': '64',
  'elk.spacing.edgeNode': '24',
  'elk.spacing.edgeEdge': '16',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.crossingMinimization.greedySwitchHierarchical.type': 'TWO_SIDED',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  'elk.padding': `[top=${MODULE_HEADER},left=${MODULE_PAD},bottom=${MODULE_PAD},right=${MODULE_PAD}]`,
}

export async function elkLayout(nodes: Node[], edges: Edge[]): Promise<Node[]> {
  if (nodes.length === 0) return nodes

  const elkById = new Map<string, ElkNode>()
  const hasChildren = new Set<string>()
  for (const n of nodes) if (n.parentId) hasChildren.add(n.parentId)

  for (const n of nodes) {
    // classNodes, view pills, core (genesis) nodes, and collapsed (childless) module
    // boxes are fixed-size leaves; expanded module boxes are containers ELK sizes
    // around children.
    const leaf =
      n.type === 'classNode' ||
      n.type === 'viewNode' ||
      n.type === 'coreNode' ||
      n.type === 'moduleNode' ||
      (n.type === 'group' && !hasChildren.has(n.id))
    const styleW = typeof n.style?.width === 'number' ? n.style.width : undefined
    const styleH = typeof n.style?.height === 'number' ? n.style.height : undefined
    elkById.set(n.id, {
      id: n.id,
      ...(leaf
        ? {
            width: styleW ?? n.measured?.width ?? CLASS_W,
            height: styleH ?? n.measured?.height ?? CLASS_H,
          }
        : { layoutOptions: OPTS }),
      children: [],
    })
  }

  const roots: ElkNode[] = []
  for (const n of nodes) {
    const e = elkById.get(n.id)!
    if (n.parentId && elkById.has(n.parentId)) elkById.get(n.parentId)!.children!.push(e)
    else roots.push(e)
  }

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: OPTS,
    children: roots,
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  }

  let res: ElkNode
  try {
    const engine = await layoutEngine()
    res = await engine.layout(graph)
  } catch {
    return nodes // fall back to whatever positions we had
  }

  const pos = new Map<string, { x: number; y: number; w: number; h: number }>()
  const walk = (n: ElkNode) => {
    pos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, w: n.width ?? 0, h: n.height ?? 0 })
    n.children?.forEach(walk)
  }
  res.children?.forEach(walk)

  return nodes.map((n) => {
    const p = pos.get(n.id)
    if (!p) return n
    const next: Node = { ...n, position: { x: p.x, y: p.y } }
    if (n.type === 'group') next.style = { ...n.style, width: p.w, height: p.h }
    return next
  })
}
