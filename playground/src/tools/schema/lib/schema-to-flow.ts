import type { Node, Edge } from '@xyflow/react'

import dagre from 'dagre'

import type { LayoutDirection } from '@/lib/types'

// ─── Schema Data Types ──────────────────────────────────────────────────────

export interface SchemaNodeData extends Record<string, unknown> {
  label: string
  kind: 'node' | 'interface'
  attributes: string[]
  methods: { name: string; returns: string }[]
  implements?: string[]
  abstract?: boolean
}

export interface SchemaEdgeData extends Record<string, unknown> {
  label: string
  sourceRole: string
  targetRole: string
  sourceCardinality?: string
  targetCardinality?: string
  constraints?: Record<string, boolean>
  edgeKind: 'relationship' | 'implements'
}

// ─── Schema Format Detection ────────────────────────────────────────────────

/**
 * Handles two schema formats:
 *
 * Distribution schema (from compileGsl):
 *   nodes[name].attributes: string[]
 *   nodes[name].implements: string[]
 *   edges[name].endpoints: { [role]: { types, cardinality? } }
 *   methods[className]: { [name]: { params, returns } }
 *
 * SerializedSchema (from typegraph-core):
 *   nodes[name].properties: JSONSchema
 *   nodes[name].extends: string[]
 *   edges[name].from/to: string | string[]
 *   edges[name].cardinality: { outbound, inbound }
 */

interface DistNode {
  abstract?: boolean
  implements?: string[]
  attributes?: string[]
}

interface DistEdge {
  endpoints?: Record<string, { types: string[]; cardinality?: { min?: number; max?: number } }>
  constraints?: Record<string, boolean>
}

interface SerNode {
  extends?: string[]
  properties?: { properties?: Record<string, unknown> }
}

interface SerEdge {
  from: string | string[]
  to: string | string[]
  cardinality: { outbound: string; inbound: string }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = Record<string, any>

function isDist(n: unknown): n is DistNode {
  return typeof n === 'object' && n !== null && 'attributes' in n
}

function isSer(e: unknown): e is SerEdge {
  return typeof e === 'object' && e !== null && 'from' in e
}

// ─── Layout ─────────────────────────────────────────────────────────────────

const NODE_WIDTH = 260
const ROW_HEIGHT = 22
const HEADER_HEIGHT = 36
const SECTION_GAP = 4
const PADDING = 12

function computeHeight(data: SchemaNodeData): number {
  let h = HEADER_HEIGHT + PADDING
  if (data.attributes.length > 0) h += data.attributes.length * ROW_HEIGHT + SECTION_GAP
  if (data.methods.length > 0) h += data.methods.length * ROW_HEIGHT + SECTION_GAP
  return Math.max(h, 60)
}

function fmtCard(c?: { min?: number; max?: number }): string {
  if (!c) return '*'
  const min = c.min ?? 0
  const max = c.max
  if (min === 0 && max === 1) return '0..1'
  if (min === 1 && max === 1) return '1'
  if (min === 0 && max === undefined) return '*'
  if (min === 1 && max === undefined) return '1..*'
  return `${min}..${max ?? '*'}`
}

function fmtSerCard(c: string): string {
  return c === 'one' ? '1' : c === 'optional' ? '0..1' : c === 'many' ? '*' : c
}

// ─── Conversion ─────────────────────────────────────────────────────────────

export function schemaToFlow(
  schema: AnySchema,
  direction: LayoutDirection = 'TB',
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const methods: Record<
    string,
    Record<string, { params?: unknown; returns?: string }>
  > = schema.methods ?? {}
  const schemaNodes: Record<string, unknown> = schema.nodes ?? {}
  const schemaEdges: Record<string, unknown> = schema.edges ?? {}

  // ── Nodes ─────────────────────────────────────────────────────────────────

  for (const [id, nodeDef] of Object.entries(schemaNodes)) {
    let attributes: string[]
    let impls: string[] | undefined
    let isAbstract = false

    if (isDist(nodeDef)) {
      attributes = nodeDef.attributes ?? []
      impls = nodeDef.implements
      isAbstract = nodeDef.abstract ?? false
    } else {
      const sn = nodeDef as SerNode
      attributes = sn.properties?.properties ? Object.keys(sn.properties.properties) : []
      impls = sn.extends
    }

    const nm = methods[id]
    const methodList = nm
      ? Object.entries(nm).map(([name, m]) => ({ name, returns: (m.returns as string) ?? 'void' }))
      : []

    const data: SchemaNodeData = {
      label: id,
      kind: isAbstract ? 'interface' : 'node',
      attributes,
      methods: methodList,
      implements: impls,
      abstract: isAbstract,
    }

    nodes.push({ id: `node:${id}`, type: 'schemaNode', position: { x: 0, y: 0 }, data })
  }

  // ── Edges (relationships) ─────────────────────────────────────────────────

  for (const [id, edgeDef] of Object.entries(schemaEdges)) {
    if (isSer(edgeDef)) {
      const from = Array.isArray(edgeDef.from) ? edgeDef.from : [edgeDef.from]
      const to = Array.isArray(edgeDef.to) ? edgeDef.to : [edgeDef.to]
      for (const f of from) {
        for (const t of to) {
          edges.push({
            id: `edge:${id}:${f}:${t}`,
            source: `node:${f}`,
            target: `node:${t}`,
            type: 'schemaEdge',
            data: {
              label: id,
              sourceRole: f,
              targetRole: t,
              sourceCardinality: fmtSerCard(edgeDef.cardinality.outbound),
              targetCardinality: fmtSerCard(edgeDef.cardinality.inbound),
              edgeKind: 'relationship',
            } satisfies SchemaEdgeData,
          })
        }
      }
    } else {
      const de = edgeDef as DistEdge
      if (!de.endpoints) continue
      const roles = Object.entries(de.endpoints)
      if (roles.length < 2) continue

      const [srcRole, srcEp] = roles[0]
      const [tgtRole, tgtEp] = roles[1]

      for (const f of srcEp.types) {
        for (const t of tgtEp.types) {
          edges.push({
            id: `edge:${id}:${f}:${t}`,
            source: `node:${f}`,
            target: `node:${t}`,
            type: 'schemaEdge',
            data: {
              label: id,
              sourceRole: srcRole,
              targetRole: tgtRole,
              sourceCardinality: fmtCard(srcEp.cardinality),
              targetCardinality: fmtCard(tgtEp.cardinality),
              constraints: de.constraints,
              edgeKind: 'relationship',
            } satisfies SchemaEdgeData,
          })
        }
      }
    }
  }

  // ── Implements edges (dashed) ─────────────────────────────────────────────

  const nodeIds = new Set(nodes.map((n) => n.id))
  for (const node of nodes) {
    const d = node.data as SchemaNodeData
    if (!d.implements) continue
    for (const parent of d.implements) {
      if (!nodeIds.has(`node:${parent}`)) continue
      edges.push({
        id: `impl:${d.label}:${parent}`,
        source: `node:${d.label}`,
        target: `node:${parent}`,
        type: 'schemaEdge',
        data: {
          label: 'implements',
          sourceRole: d.label,
          targetRole: parent,
          edgeKind: 'implements',
        } satisfies SchemaEdgeData,
      })
    }
  }

  // ── Dagre layout ──────────────────────────────────────────────────────────

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: 80, ranksep: 100 })

  for (const node of nodes) {
    const h = computeHeight(node.data as SchemaNodeData)
    g.setNode(node.id, { width: NODE_WIDTH, height: h })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  for (const node of nodes) {
    const pos = g.node(node.id)
    const h = computeHeight(node.data as SchemaNodeData)
    node.position = { x: pos.x - NODE_WIDTH / 2, y: pos.y - h / 2 }
  }

  return { nodes, edges }
}
