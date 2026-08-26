import type { StudioCore, StudioSchemaBundle } from '@shared/types'

import { type Edge, MarkerType, type Node } from '@xyflow/react'

import { moduleHue } from '../modules'

// ── shared helpers ─────────────────────────────────────────────────────────

export const nodeAnchor = (path: string) => `core.node.${path}`
export const lastSeg = (path: string) => path.split('/').filter(Boolean).pop() ?? path

const propertyKeyPattern = /^.+:class\.[A-Za-z][A-Za-z0-9_]*\.property\.([A-Za-z][A-Za-z0-9_]*)$/

export interface CoreDataEntry {
  /** Exact key retained by the canonical Core declaration. */
  key: string
  /** Short property name when unambiguous, otherwise the exact key. */
  label: string
  value: unknown
}

/** Present canonical property keys without discarding their exact identity. */
export function coreDataEntries(data: Record<string, unknown>): CoreDataEntry[] {
  const entries = Object.entries(data).map(([key, value]) => ({
    key,
    shortName: propertyKeyPattern.exec(key)?.[1] ?? key,
    value,
  }))
  const counts = new Map<string, number>()
  for (const entry of entries) {
    counts.set(entry.shortName, (counts.get(entry.shortName) ?? 0) + 1)
  }
  return entries.map(({ key, shortName, value }) => ({
    key,
    label: counts.get(shortName) === 1 ? shortName : key,
    value,
  }))
}

function displayField(
  data: Record<string, unknown>,
  names: readonly string[],
): CoreDataEntry | undefined {
  const entries = coreDataEntries(data)
  return names.flatMap((name) => entries.filter((entry) => entry.label === name))[0]
}

/** A node's human label: its `name`/`title` field, else the last path segment. */
export function displayName(n: { path: string; data: Record<string, unknown> }): string {
  const v = displayField(n.data, ['name', 'title'])?.value
  return typeof v === 'string' && v ? v : lastSeg(n.path)
}

/** Stable hue per className (so a class is the same colour across the canvas + tree). */
export function hueMapOf(core: StudioCore): Map<string, number> {
  const names = [...new Set(core.nodes.map((n) => n.className))].sort()
  return new Map(names.map((name, i) => [name, moduleHue(i)]))
}

export const fmtVal = (v: unknown): string => {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(fmtVal).join(', ')
  return JSON.stringify(v)
}

/** Up to `max` data fields for a compact card preview, skipping the title field. */
export function previewFields(
  n: { path: string; data: Record<string, unknown> },
  max = 2,
): [string, string][] {
  const titleField = displayField(n.data, ['name', 'title'])
  return coreDataEntries(n.data)
    .filter((entry) => entry.key !== titleField?.key)
    .slice(0, max)
    .map(({ label, value }) => [label, fmtVal(value)] as [string, string])
}

export function classIcon(bundle: StudioSchemaBundle, className: string): string | undefined {
  return bundle.ir?.classes?.[className]?.icon
}

export interface CoreNodeData extends Record<string, unknown> {
  path: string
  className: string
  title: string
  hue: number
  icon?: string
  fields: [string, string][]
  selected: boolean
  /** A semantic endpoint (currently the owning Domain), not a materialized Core node. */
  virtual?: boolean
}

// ── structure (nodes + edges, pre-layout) ───────────────────────────────────

export function buildCoreGraph(
  core: StudioCore,
  bundle: StudioSchemaBundle,
  hues: Map<string, number>,
): { nodes: Node[]; edges: Edge[] } {
  const ids = new Set(core.nodes.map((n) => nodeAnchor(n.path)))
  const nodes: Node[] = core.nodes.map((n) => {
    const fields = previewFields(n)
    return {
      id: nodeAnchor(n.path),
      type: 'coreNode',
      position: { x: 0, y: 0 },
      data: {
        path: n.path,
        className: n.className,
        title: displayName(n),
        hue: hues.get(n.className) ?? 264,
        icon: classIcon(bundle, n.className),
        fields,
        selected: false,
      } satisfies CoreNodeData,
      style: { width: 184, height: 50 + fields.length * 15 },
    }
  })

  // Canonical Core edges may connect a concrete Core node to the owning Domain
  // (`domain()`, serialized as `/:origin`). Materialize that semantic endpoint
  // as a small virtual card so the edge is visible without pretending it is
  // another genesis node in the tree or detail panel.
  const domainPath = `/:${core.domain}`
  for (const path of new Set(core.edges.flatMap((edge) => [edge.from, edge.to]))) {
    const id = nodeAnchor(path)
    if (ids.has(id)) continue
    const domainEndpoint = path === domainPath
    nodes.push({
      id,
      type: 'coreNode',
      position: { x: 0, y: 0 },
      selectable: false,
      focusable: false,
      data: {
        path,
        className: domainEndpoint ? 'Domain' : 'External',
        title: domainEndpoint ? core.domain : lastSeg(path),
        hue: domainEndpoint ? 210 : 264,
        fields: [],
        selected: false,
        virtual: true,
      } satisfies CoreNodeData,
      style: { width: 184, height: 50 },
    })
    ids.add(id)
  }

  const edges: Edge[] = []
  // structural parent → child (subtle dashed) so the hierarchy reads on the canvas
  for (const n of core.nodes) {
    if (!n.parent) continue
    const source = nodeAnchor(n.parent)
    const target = nodeAnchor(n.path)
    if (!ids.has(source) || !ids.has(target)) continue
    edges.push({
      id: `core.struct.${n.path}`,
      source,
      target,
      type: 'tree',
      data: { structural: true },
      style: { stroke: 'oklch(0.78 0.01 255)', strokeWidth: 1.4, strokeDasharray: '4 4' },
    })
  }
  // typed core edges (solid, coloured, labelled) — the genesis wiring
  for (const e of core.edges) {
    const source = nodeAnchor(e.from)
    const target = nodeAnchor(e.to)
    if (!ids.has(source) || !ids.has(target)) continue
    const color = 'oklch(0.6 0.12 35)'
    edges.push({
      id: `core.edge.${e.from}__${e.edgeName}__${e.to}`,
      source,
      target,
      type: 'floating',
      data: { label: e.edgeName },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      style: { stroke: color, strokeWidth: 2 },
    })
  }
  return { nodes, edges }
}
