import type { StudioCore, StudioSchemaBundle } from '@shared/types'

import { type Edge, MarkerType, type Node } from '@xyflow/react'

import { moduleHue } from '../modules'

// ── shared helpers ─────────────────────────────────────────────────────────

export const nodeAnchor = (path: string) => `core.node.${path}`
/** A typed edge is keyed by its position in `StudioCore.edges`: two edges may share a triple. */
export const coreEdgeId = (index: number) => `core.edge.${index}`
export const lastSeg = (path: string) => path.split('/').filter(Boolean).pop() ?? path

export type SpotlightTone = 'focus' | 'pass' | 'fail'
export type SpotlightMark = 'subject' | 'object'

/**
 * What the canvas lifts and what it fades — React Flow ids, so structural edges count too.
 * `focus` is the neighbourhood of a clicked card; `pass` and `fail` are a policy's verdict,
 * with the picked subject and object labelled through `marks`.
 */
export interface CoreSpotlight {
  nodeIds: ReadonlySet<string>
  edgeIds: ReadonlySet<string>
  tone: SpotlightTone
  marks?: ReadonlyMap<string, SpotlightMark>
}

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

/** The field a card is titled by: `name` first, else `title`. */
function titleField(entries: readonly CoreDataEntry[]): CoreDataEntry | undefined {
  for (const name of ['name', 'title']) {
    const entry = entries.find((candidate) => candidate.label === name)
    if (entry) return entry
  }
  return undefined
}

/** A node's human label: its `name`/`title` field, else the last path segment. */
export function displayName(n: { path: string; data: Record<string, unknown> }): string {
  const v = titleField(coreDataEntries(n.data))?.value
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
  const entries = coreDataEntries(n.data)
  const title = titleField(entries)
  return entries
    .filter((entry) => entry.key !== title?.key)
    .slice(0, max)
    .map(({ label, value }) => [label, fmtVal(value)] as [string, string])
}

export function classIcon(bundle: StudioSchemaBundle, className: string): string | undefined {
  return bundle.ir?.classes?.[className]?.icon
}

export interface CoreNodeData extends Record<string, unknown> {
  domainId: string
  path: string
  className: string
  title: string
  hue: number
  icon?: string
  fields: [string, string][]
  selected: boolean
  /** A semantic endpoint (currently the owning Domain), not a materialized Core node. */
  virtual?: boolean
  /** the spotlight's label on this card, and the tone it wears */
  mark?: SpotlightMark
  tone?: SpotlightTone
  /** whether the card offers a comment pin — demo data is not something to annotate */
  commentable?: boolean
}

export interface CoreGraphOptions {
  /** name and class only, no data preview on the cards */
  compact?: boolean
  commentable?: boolean
}

// ── structure (nodes + edges, pre-layout) ───────────────────────────────────

const CORE_EDGE_COLOR = 'oklch(0.6 0.12 35)'

export function buildCoreGraph(
  core: StudioCore,
  bundle: StudioSchemaBundle,
  hues: Map<string, number>,
  domainId: string,
  options: CoreGraphOptions = {},
): { nodes: Node[]; edges: Edge[] } {
  const ids = new Set(core.nodes.map((n) => nodeAnchor(n.path)))
  const commentable = options.commentable !== false
  const nodes: Node[] = core.nodes.map((n) => {
    const fields = options.compact ? [] : previewFields(n)
    return {
      id: nodeAnchor(n.path),
      type: 'coreNode',
      position: { x: 0, y: 0 },
      data: {
        domainId,
        path: n.path,
        className: n.className,
        title: displayName(n),
        hue: hues.get(n.className) ?? 264,
        icon: classIcon(bundle, n.className),
        fields,
        selected: false,
        commentable,
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
        domainId,
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
  // typed core edges (solid, coloured, labelled) — the genesis wiring
  core.edges.forEach((e, index) => {
    const source = nodeAnchor(e.from)
    const target = nodeAnchor(e.to)
    if (!ids.has(source) || !ids.has(target)) return
    edges.push({
      id: coreEdgeId(index),
      source,
      target,
      type: 'floating',
      data: { label: e.edgeName, index },
      markerEnd: { type: MarkerType.ArrowClosed, color: CORE_EDGE_COLOR, width: 16, height: 16 },
      style: { stroke: CORE_EDGE_COLOR, strokeWidth: 2 },
    })
  })
  return { nodes, edges }
}
